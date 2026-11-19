import json
import os
import subprocess
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests

from conftest import Server, make_project
from app import services as svc


# ------------------------------------------------------------------ auth + error shape
def test_register_login_me_and_error_shape(server):
    c = server.signup()
    me = c.get("/v1/me").json()
    assert me["email"] == "a@example.com" and me["plan"] == "free" and me["minutes_remaining"] == 120
    assert me["allow_training"] is False and me["watermark"] is False        # privacy default, no watermark on free
    dup = requests.post(server.base + "/v1/auth/register", json={"email": "A@example.com", "password": "another-pass-1"})
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "EMAIL_TAKEN"
    bad = requests.post(server.base + "/v1/auth/login", json={"email": "a@example.com", "password": "nope-nope-1"})
    assert bad.status_code == 401
    err = bad.json()["error"]
    assert set(err) == {"code", "message_ar", "message_en", "details", "request_id"} and "كلمة المرور" in err["message_ar"]
    assert bad.headers["X-Request-ID"] == err["request_id"]
    ok = requests.post(server.base + "/v1/auth/login", json={"email": "a@example.com", "password": "correct-horse-1"})
    assert ok.status_code == 200 and ok.json()["token"]
    assert requests.get(server.base + "/v1/me").status_code == 401
    v = requests.post(server.base + "/v1/auth/register", json={"email": "x", "password": "short"})
    assert v.status_code == 422 and v.json()["error"]["code"] == "VALIDATION_ERROR" and v.json()["error"]["details"]


def test_profile_patch_and_training_consent(server):
    c = server.signup()
    r = c.patch("/v1/me", {"locale": "en", "allow_training": True, "name": "Sara"}).json()
    assert (r["locale"], r["allow_training"], r["name"]) == ("en", True, "Sara")
    assert c.patch("/v1/me", {"locale": "fr"}).status_code == 422


# ------------------------------------------------------------------ full happy path
def test_full_flow_upload_analyze_edit_export_download(server, video_bytes, srt_text):
    c = server.signup()
    pid = make_project(c, video_bytes, srt_text)
    proj = c.get(f"/v1/projects/{pid}").json()
    assert proj["status"] == "ready" and proj["source"]["width"] == 1280 and proj["source"]["has_subtitles"]

    j = c.post(f"/v1/projects/{pid}/analyze", {"max_clips": 6})
    assert j.status_code == 202 and j.json()["status"] == "queued"
    jid = j.json()["id"]
    minutes = proj["source"]["duration"] / 60
    assert abs(c.get("/v1/me").json()["minutes_remaining"] - (120 - minutes)) < 0.05          # credits reserved
    assert c.post(f"/v1/projects/{pid}/analyze", {}).json()["id"] == jid                         # no duplicate active job

    server.drain()
    done = c.get(f"/v1/jobs/{jid}").json()
    assert done["status"] == "done" and done["progress"] == 1 and done["result"]["suggestions"] >= 3
    items = c.get(f"/v1/projects/{pid}/suggestions").json()["items"]
    assert len(items) >= 3 and items[0]["rank"] == 1 and "score_breakdown" not in items[0]
    assert set(items[0]["scores"]) == {"hook", "complete", "value", "audio", "visual", "engage"} and items[0]["reason_ar"]
    assert c.get(f"/v1/projects/{pid}").json()["status"] == "done"
    assert c.get(f"/v1/projects/{pid}/transcript").json()["segments"]
    assert (server.settings.project_dir(pid) / "proxy.mp4").exists()

    clip = c.post(f"/v1/projects/{pid}/clips", {"suggestion_id": items[0]["id"]})
    assert clip.status_code == 201
    clip = clip.json()
    assert clip["version"] == 1 and clip["edit_state"]["layout"] == "fill"

    assert c.patch(f"/v1/clips/{clip['id']}", {"edit_state": {"layout": "fit"}}).status_code == 428
    stale = c.patch(f"/v1/clips/{clip['id']}", {"edit_state": {"layout": "fit"}}, headers={"If-Match": "99"})
    assert stale.status_code == 409 and stale.json()["error"]["details"]["current_version"] == 1
    ok = c.patch(f"/v1/clips/{clip['id']}", {"title": "عنوان جديد", "edit_state": {"layout": "fit", "caption": {"mode": "plain"}}},
                 headers={"If-Match": "1"})
    assert ok.status_code == 200 and ok.json()["version"] == 2 and ok.headers["ETag"] == '"2"'
    assert ok.json()["edit_state"]["caption"]["emphasis"] is not None and ok.json()["edit_state"]["caption"]["mode"] == "plain"
    bad = c.patch(f"/v1/clips/{clip['id']}", {"edit_state": {"layout": "weird"}}, headers={"If-Match": "2"})
    assert bad.status_code == 422
    assert c.patch(f"/v1/clips/{clip['id']}", {"edit_state": {"layout": "fill"}}, headers={"If-Match": "2"}).json()["version"] == 3

    ex = c.post(f"/v1/clips/{clip['id']}/exports", {"resolution": "720p"}, headers={"Idempotency-Key": "k-1"})
    assert ex.status_code == 202
    again = c.post(f"/v1/clips/{clip['id']}/exports", {"resolution": "720p"}, headers={"Idempotency-Key": "k-1"})
    assert again.headers.get("Idempotent-Replay") == "true" and again.json()["export"]["id"] == ex.json()["export"]["id"]
    assert c.get(f"/v1/exports/{ex.json()['export']['id']}/file").status_code == 409            # not ready yet
    server.drain()
    eid = ex.json()["export"]["id"]
    e = c.get(f"/v1/exports/{eid}").json()
    assert e["status"] == "done" and e["download_url"] == f"/v1/exports/{eid}/file"
    f = c.get(f"/v1/exports/{eid}/file?download=1")
    assert f.status_code == 200 and f.headers["content-type"] == "video/mp4" and "attachment" in f.headers["content-disposition"]
    out = Path(server.settings.data_dir) / "dl.mp4"
    out.write_bytes(f.content)
    meta = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", str(out)]))
    v = next(s for s in meta["streams"] if s["codec_type"] == "video")
    assert (v["width"], v["height"]) == (720, 1280)
    part = requests.get(server.base + f"/v1/exports/{eid}/file", headers={"Authorization": f"Bearer {c.token}", "Range": "bytes=0-99"})
    assert part.status_code == 206 and len(part.content) == 100


# ------------------------------------------------------------------ uploads
def test_upload_validation(server, video_bytes):
    c = server.signup()
    pid = c.post("/v1/projects", {"name": "x"}).json()["id"]
    assert c.req("POST", f"/v1/projects/{pid}/source?filename=evil.exe", data=b"abc").status_code == 415
    r = c.req("POST", f"/v1/projects/{pid}/source?filename=fake.mp4", data=b"this is not a video")
    assert r.status_code == 415 and r.json()["error"]["code"] == "UNSUPPORTED_MEDIA"
    assert not list(server.settings.project_dir(pid).glob("*.part"))                             # temp file cleaned
    assert c.post(f"/v1/projects/{pid}/analyze", {}).json()["error"]["code"] == "NO_SOURCE"
    assert c.req("PUT", f"/v1/projects/{pid}/subtitles", data=b"1\n00:00:01,000 --> 00:00:02,000\nhi").json()["error"]["code"] == "NO_SOURCE"


def test_upload_size_limit(tmp_path, video_bytes):
    s = Server(tmp_path / "d", max_upload_mb=1)
    try:
        c = s.signup()
        pid = c.post("/v1/projects", {"name": "x"}).json()["id"]
        r = c.req("POST", f"/v1/projects/{pid}/source?filename=a.mp4", data=b"0" * (1024 * 1024 + 10))
        assert r.status_code == 413 and r.json()["error"]["code"] == "FILE_TOO_LARGE"
    finally:
        s.stop()


def test_too_long_video_rejected(tmp_path, video_bytes):
    s = Server(tmp_path / "d", max_source_minutes=1)                                              # sample is ~3 minutes
    try:
        c = s.signup()
        pid = c.post("/v1/projects", {"name": "x"}).json()["id"]
        r = c.req("POST", f"/v1/projects/{pid}/source?filename=a.mp4", data=video_bytes)
        assert r.status_code == 422 and r.json()["error"]["code"] == "TOO_LONG"
    finally:
        s.stop()


def test_bad_subtitles_rejected(server, video_bytes):
    c = server.signup()
    pid = make_project(c, video_bytes, None)
    r = c.req("PUT", f"/v1/projects/{pid}/subtitles", data=b"just some text")
    assert r.status_code == 422


# ------------------------------------------------------------------ quota, refunds, failures
def test_quota_exceeded_and_asr_failure_refunds(server, video_bytes, srt_text, monkeypatch):
    c = server.signup()
    # no subtitles + no ASR installed -> job fails with ASR_UNAVAILABLE and the minutes come back
    pid = make_project(c, video_bytes, None)
    before = c.get("/v1/me").json()["minutes_remaining"]
    jid = c.post(f"/v1/projects/{pid}/analyze", {}).json()["id"]
    assert c.get("/v1/me").json()["minutes_remaining"] < before
    server.drain()
    j = c.get(f"/v1/jobs/{jid}").json()
    assert j["status"] == "error" and j["error"]["code"] == "ASR_UNAVAILABLE" and j["error"]["message_ar"]
    assert abs(c.get("/v1/me").json()["minutes_remaining"] - before) < 0.01
    assert c.get(f"/v1/projects/{pid}").json()["status"] == "ready"
    # ASR explicitly disabled -> early 503
    monkeypatch.setenv("ASR_PROVIDER", "none")
    assert c.post(f"/v1/projects/{pid}/analyze", {}).status_code == 503
    monkeypatch.delenv("ASR_PROVIDER")
    # quota
    monkeypatch.setitem(svc.PLANS["free"], "minutes", 1)
    pid2 = make_project(c, video_bytes, srt_text)
    q = c.post(f"/v1/projects/{pid2}/analyze", {})
    assert q.status_code == 403 and q.json()["error"]["code"] == "QUOTA_EXCEEDED"
    assert q.json()["error"]["details"]["needed_minutes"] > q.json()["error"]["details"]["remaining_minutes"]
    assert c.get(f"/v1/projects/{pid2}").json()["status"] == "ready"


def test_cancel_queued_job_refunds(server, video_bytes, srt_text):
    c = server.signup()
    pid = make_project(c, video_bytes, srt_text)
    before = c.get("/v1/me").json()["minutes_remaining"]
    jid = c.post(f"/v1/projects/{pid}/analyze", {}).json()["id"]
    assert c.delete(f"/v1/jobs/{jid}").json()["status"] == "canceled"
    assert abs(c.get("/v1/me").json()["minutes_remaining"] - before) < 0.01
    server.drain()                                                                               # canceled job is not run
    assert c.get(f"/v1/jobs/{jid}").json()["status"] == "canceled"


# ------------------------------------------------------------------ isolation
def test_other_users_cannot_see_or_touch_my_data(server, video_bytes, srt_text):
    a, b = server.signup("a@example.com"), server.signup("b@example.com")
    pid = make_project(a, video_bytes, srt_text)
    jid = a.post(f"/v1/projects/{pid}/analyze", {}).json()["id"]
    server.drain()
    sid = a.get(f"/v1/projects/{pid}/suggestions").json()["items"][0]["id"]
    cid = a.post(f"/v1/projects/{pid}/clips", {"suggestion_id": sid}).json()["id"]
    eid = a.post(f"/v1/clips/{cid}/exports", {"resolution": "720p"}).json()["export"]["id"]
    server.drain()
    for method, path in [("GET", f"/v1/projects/{pid}"), ("DELETE", f"/v1/projects/{pid}"), ("GET", f"/v1/projects/{pid}/suggestions"),
                         ("GET", f"/v1/projects/{pid}/media"), ("GET", f"/v1/jobs/{jid}"), ("GET", f"/v1/clips/{cid}"),
                         ("GET", f"/v1/exports/{eid}"), ("GET", f"/v1/exports/{eid}/file"), ("POST", f"/v1/clips/{cid}/exports")]:
        r = b.req(method, path, json={} if method == "POST" else None)
        assert r.status_code == 404, (method, path, r.status_code)
    assert b.get("/v1/projects").json()["items"] == []
    assert a.get(f"/v1/exports/{eid}/file").status_code == 200


# ------------------------------------------------------------------ review links
def test_review_link_public_comments_and_expiry(server, video_bytes, srt_text):
    c = server.signup()
    pid = make_project(c, video_bytes, srt_text)
    c.post(f"/v1/projects/{pid}/analyze", {})
    server.drain()
    sid = c.get(f"/v1/projects/{pid}/suggestions").json()["items"][0]["id"]
    cid = c.post(f"/v1/projects/{pid}/clips", {"suggestion_id": sid}).json()["id"]
    c.post(f"/v1/clips/{cid}/exports", {"resolution": "720p"})
    server.drain()
    link = c.post(f"/v1/clips/{cid}/review-links", {"expires_in_hours": 2}).json()
    anon = server.client()
    page = anon.get(f"/v1/review/{link['token']}").json()
    assert page["has_video"] and page["allow_comments"] and page["comments"] == []
    assert anon.get(f"/v1/review/{link['token']}/file").status_code == 200
    assert anon.post(f"/v1/review/{link['token']}/comments", {"author": "منى", "body": "ممتاز! قصّ أول ثانيتين", "at_seconds": 1.5}).status_code == 201
    assert anon.get(f"/v1/review/{link['token']}").json()["comments"][0]["author"] == "منى"
    assert c.get(f"/v1/clips/{cid}/comments").json()["items"][0]["at_seconds"] == 1.5
    assert anon.get("/v1/review/not-a-token").status_code == 404
    server.db.run("UPDATE review_links SET expires_at=? WHERE token=?", "2000-01-01T00:00:00+00:00", link["token"])
    assert anon.get(f"/v1/review/{link['token']}").status_code == 410
    assert anon.get("/v1/clips/" + cid).status_code == 401                                        # link never grants account access


# ------------------------------------------------------------------ privacy: deletion + retention
def test_delete_project_and_account_remove_everything(server, video_bytes, srt_text):
    c = server.signup()
    pid = make_project(c, video_bytes, srt_text)
    c.post(f"/v1/projects/{pid}/analyze", {})
    server.drain()
    sid = c.get(f"/v1/projects/{pid}/suggestions").json()["items"][0]["id"]
    cid = c.post(f"/v1/projects/{pid}/clips", {"suggestion_id": sid}).json()["id"]
    c.post(f"/v1/clips/{cid}/exports", {"resolution": "720p"})
    server.drain()
    export_files = list(server.settings.export_dir().glob("*.mp4"))
    assert export_files and server.settings.project_dir(pid).exists()
    assert c.delete(f"/v1/projects/{pid}").status_code == 204
    assert not server.settings.project_dir(pid).exists() and not list(server.settings.export_dir().glob("*.mp4"))
    assert server.db.one("SELECT COUNT(*) AS n FROM clips")["n"] == 0
    # whole account
    pid2 = make_project(c, video_bytes, srt_text)
    assert c.delete("/v1/me", {"password": "wrong-pass-123"}).status_code == 401
    assert c.delete("/v1/me", {"password": "correct-horse-1"}).status_code == 204
    assert not server.settings.project_dir(pid2).exists()
    assert server.db.one("SELECT COUNT(*) AS n FROM users")["n"] == 0
    assert requests.post(server.base + "/v1/auth/login", json={"email": "a@example.com", "password": "correct-horse-1"}).status_code == 401
    assert c.get("/v1/me").status_code == 401


def test_retention_purge(server, video_bytes, srt_text):
    c = server.signup()
    old = make_project(c, video_bytes, srt_text, "قديم")
    fresh = make_project(c, video_bytes, srt_text, "جديد")
    long = (datetime.now(timezone.utc) - timedelta(days=40)).isoformat(timespec="seconds")
    server.db.run("UPDATE projects SET updated_at=?, retention_days=30 WHERE id=?", long, old)
    res = svc.purge_expired(server.db, server.settings)
    assert res["projects"] == 1
    assert not server.settings.project_dir(old).exists() and server.settings.project_dir(fresh).exists()


# ------------------------------------------------------------------ transport concerns
def test_rate_limit_returns_429_with_retry_after(tmp_path):
    s = Server(tmp_path / "d")
    s.app.state.ctx.settings.rate_limit_per_min = 5
    try:
        c = s.signup()
        codes = [c.get("/v1/me") for _ in range(8)]
        limited = [r for r in codes if r.status_code == 429]
        assert limited and int(limited[0].headers["Retry-After"]) >= 1
        assert limited[0].json()["error"]["code"] == "RATE_LIMITED"
    finally:
        s.stop()


def test_sse_progress_stream(server, video_bytes, srt_text):
    c = server.signup()
    pid = make_project(c, video_bytes, srt_text)
    jid = c.post(f"/v1/projects/{pid}/analyze", {}).json()["id"]
    t = threading.Thread(target=lambda: (time.sleep(0.6), server.drain()))
    t.start()
    events = []
    with requests.get(server.base + f"/v1/jobs/{jid}/events?access_token={c.token}", stream=True, timeout=60) as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        for line in r.iter_lines(decode_unicode=True):
            if line and line.startswith("data: "):
                events.append(json.loads(line[6:]))
                if events[-1]["status"] in ("done", "error"):
                    break
    t.join()
    assert events[0]["status"] in ("queued", "running") and events[-1]["status"] == "done"
    assert [e["progress"] for e in events] == sorted(e["progress"] for e in events)


def test_cors_and_health(server):
    r = requests.options(server.base + "/v1/me", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET",
                                                          "Access-Control-Request-Headers": "authorization"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert requests.get(server.base + "/healthz").json()["status"] == "ok"


# ------------------------------------------------------------------ import from a link (YouTube etc.)
def test_import_url_rejects_unsafe_links(server, monkeypatch):
    from app import downloader
    monkeypatch.setattr(downloader, "available", lambda: True)
    c = server.signup()
    pid = c.post("/v1/projects", {"name": "x"}).json()["id"]
    for bad in ["ftp://example.com/v.mp4", "file:///etc/passwd", "http://localhost/v.mp4", "http://127.0.0.1/v.mp4",
                "http://169.254.169.254/latest/meta-data", "http://192.168.1.5/a.mp4", "http://[::1]/a.mp4",
                "https://user:pw@example.com/v.mp4", "https://example.com:8080/v.mp4", "not a url at all"]:
        r = c.post(f"/v1/projects/{pid}/source-url", {"url": bad})
        assert r.status_code == 422 and r.json()["error"]["code"] == "URL_INVALID", (bad, r.text)
    assert c.post(f"/v1/projects/{pid}/source-url", {}).status_code == 422
    other = server.signup("b@example.com")
    assert other.post(f"/v1/projects/{pid}/source-url", {"url": "https://example.com/v.mp4"}).status_code in (403, 404)


def test_import_url_unavailable_without_ytdlp(server, monkeypatch):
    from app import downloader
    monkeypatch.setattr(downloader, "available", lambda: False)
    monkeypatch.setattr(downloader, "validate_url", lambda u, resolve=True: u)
    c = server.signup()
    pid = c.post("/v1/projects", {"name": "x"}).json()["id"]
    r = c.post(f"/v1/projects/{pid}/source-url", {"url": "https://www.youtube.com/watch?v=abc"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "DOWNLOAD_UNAVAILABLE"


def test_import_url_downloads_then_analyze_works(server, video_bytes, srt_text, monkeypatch):
    from app import downloader
    calls = []

    def fake_download(url, dest, max_minutes, max_bytes, hook=None):
        calls.append((url, max_minutes))
        dest.mkdir(parents=True, exist_ok=True)
        f = dest / "import.mp4"
        f.write_bytes(video_bytes)
        hook and hook(0.5)
        return f, "حلقة: عن الإنتاجية / نصائح"

    monkeypatch.setattr(downloader, "available", lambda: True)
    monkeypatch.setattr(downloader, "validate_url", lambda u, resolve=True: u)
    monkeypatch.setattr(downloader, "download", fake_download)
    c = server.signup()
    pid = c.post("/v1/projects", {"name": "من يوتيوب"}).json()["id"]
    j = c.post(f"/v1/projects/{pid}/source-url", {"url": "https://www.youtube.com/watch?v=abc123"})
    assert j.status_code == 202 and j.json()["kind"] == "import" and j.json()["status"] == "queued"
    assert c.post(f"/v1/projects/{pid}/source-url", {"url": "https://www.youtube.com/watch?v=abc123"}).json()["id"] == j.json()["id"]
    assert c.get("/v1/me").json()["minutes_remaining"] == 120                       # downloading is free
    server.drain()
    done = c.get(f"/v1/jobs/{j.json()['id']}").json()
    assert done["status"] == "done" and done["progress"] == 1 and calls == [("https://www.youtube.com/watch?v=abc123", 180)]
    proj = c.get(f"/v1/projects/{pid}").json()
    assert proj["status"] == "ready" and proj["source"]["width"] == 1280
    assert "/" not in proj["source"]["filename"] and proj["source"]["filename"].endswith(".mp4") and "حلقة" in proj["source"]["filename"]
    assert c.get(f"/v1/projects/{pid}/media").status_code == 200                      # streamable like an upload
    r = c.req("PUT", f"/v1/projects/{pid}/subtitles", data=srt_text.encode("utf-8"))
    assert r.status_code == 200
    a = c.post(f"/v1/projects/{pid}/analyze", {"max_clips": 5})
    assert a.status_code == 202
    server.drain()
    assert c.get(f"/v1/jobs/{a.json()['id']}").json()["status"] == "done"


def test_import_url_failure_is_reported_and_nothing_charged(server, monkeypatch):
    from app import downloader

    def boom(*a, **k):
        raise downloader.DownloadError("DOWNLOAD_FAILED", "HTTP Error 403: Forbidden")

    monkeypatch.setattr(downloader, "available", lambda: True)
    monkeypatch.setattr(downloader, "validate_url", lambda u, resolve=True: u)
    monkeypatch.setattr(downloader, "download", boom)
    c = server.signup()
    pid = c.post("/v1/projects", {"name": "x"}).json()["id"]
    j = c.post(f"/v1/projects/{pid}/source-url", {"url": "https://www.youtube.com/watch?v=zzz"}).json()
    server.drain()
    done = c.get(f"/v1/jobs/{j['id']}").json()
    assert done["status"] == "error" and done["error"]["code"] == "DOWNLOAD_FAILED" and "تنزيل" in done["error"]["message_ar"]
    assert c.get(f"/v1/projects/{pid}").json()["source"] is None
    assert c.get("/v1/me").json()["minutes_remaining"] == 120


def test_validate_url_accepts_public_hosts():
    from app import downloader
    assert downloader.validate_url("https://www.youtube.com/watch?v=abc", resolve=False).startswith("https://www.youtube.com")
    assert downloader.validate_url("http://93.184.216.34/video.mp4")                  # public literal IP
