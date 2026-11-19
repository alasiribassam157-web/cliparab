"""HTTP routes under /v1. All handlers go through ``endpoint`` for request ids, rate limits and the unified error shape."""

from __future__ import annotations

import asyncio
import json
import secrets
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

import anyio
from pydantic import BaseModel, ValidationError
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response, StreamingResponse
from starlette.routing import Route

from cliparab_core import media
from cliparab_core.models import Transcript
from cliparab_core.render import EditState
from cliparab_core.subtitles import parse_subtitles

from . import downloader
from . import schemas as S
from . import services as svc
from .config import Settings
from .db import Db, jdump, jload, new_id, now
from .errors import ApiError
from .security import user_id_for_key

ALLOWED_EXT = {".mp4", ".mov", ".mkv", ".webm", ".m4v", ".mp3", ".wav", ".m4a"}


class Ctx:
    """Shared application state."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.db = Db(settings.db_path)
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def rate_limit(self, key: str) -> None:
        q, t = self._hits[key], time.monotonic()
        while q and t - q[0] > 60:
            q.popleft()
        if len(q) >= self.settings.rate_limit_per_min:
            raise ApiError("RATE_LIMITED", headers={"Retry-After": str(max(1, int(60 - (t - q[0]))))})
        q.append(t)


def build_routes(ctx: Ctx) -> list[Route]:
    db, st = ctx.db, ctx.settings

    # ------------------------------------------------------------------ plumbing
    def endpoint(fn: Callable[[Request], Awaitable[Response]]):
        async def handler(request: Request) -> Response:
            rid = request.headers.get("x-request-id") or "req_" + uuid.uuid4().hex[:16]
            request.state.rid = rid
            try:
                resp = await fn(request)
            except ApiError as e:
                resp = JSONResponse(e.body(rid), status_code=e.status, headers=e.headers)
            except ValidationError as e:
                details = [{"field": ".".join(str(x) for x in err["loc"]), "message": err["msg"]} for err in e.errors()]
                resp = JSONResponse(ApiError("VALIDATION_ERROR", details).body(rid), status_code=422)
            except Exception as e:  # noqa: BLE001
                import logging
                logging.getLogger("cliparab.api").exception("unhandled error %s", rid)
                resp = JSONResponse(ApiError("INTERNAL", {"type": type(e).__name__}).body(rid), status_code=500)
            resp.headers["X-Request-ID"] = rid
            return resp
        return handler

    def user_of(request: Request, allow_query_token: bool = False) -> dict:
        """The caller's anonymous user, created on first use from their session key."""
        auth = request.headers.get("authorization", "")
        key = auth[7:] if auth.lower().startswith("bearer ") else (request.query_params.get("access_token") if allow_query_token else None)
        uid = user_id_for_key(key)
        if not uid:
            raise ApiError("UNAUTHENTICATED")
        u = db.one("SELECT * FROM users WHERE id=?", uid)
        if not u:
            db.run("INSERT OR IGNORE INTO users(id,email,name,pw_hash,created_at) VALUES (?,?,?,?,?)", uid, f"{uid}@device.local", "", "-", now())
            u = db.one("SELECT * FROM users WHERE id=?", uid)
        ctx.rate_limit(u["id"])
        return u

    async def parse(request: Request, model: type[BaseModel]) -> Any:
        try:
            raw = await request.json()
        except Exception:  # noqa: BLE001
            raw = {}
        return model.model_validate(raw if isinstance(raw, dict) else {})

    def own_project(u: dict, pid: str) -> dict:
        p = db.one("SELECT * FROM projects WHERE id=? AND user_id=?", pid, u["id"])
        if not p:
            raise ApiError("NOT_FOUND")
        return p

    def own_clip(u: dict, cid: str) -> dict:
        c = db.one("SELECT * FROM clips WHERE id=? AND user_id=?", cid, u["id"])
        if not c:
            raise ApiError("NOT_FOUND")
        return c

    def source_of(pid: str) -> dict | None:
        return db.one("SELECT * FROM sources WHERE project_id=?", pid)

    def touch(pid: str, status: str | None = None) -> None:
        if status:
            db.run("UPDATE projects SET status=?, updated_at=? WHERE id=?", status, now(), pid)
        else:
            db.run("UPDATE projects SET updated_at=? WHERE id=?", now(), pid)

    def audit(uid: str | None, action: str, meta: Any = None) -> None:
        db.run("INSERT INTO audit_logs(id,user_id,action,meta,created_at) VALUES (?,?,?,?,?)", new_id("a_"), uid, action, jdump(meta), now())

    def idempotent(request: Request, u: dict, route: str):
        key = request.headers.get("idempotency-key")
        if not key:
            return None, None
        hit = db.one("SELECT * FROM idempotency WHERE key=? AND user_id=? AND route=?", key, u["id"], route)
        return key, (JSONResponse(json.loads(hit["response"]), status_code=hit["status_code"], headers={"Idempotent-Replay": "true"}) if hit else None)

    def remember(key: str | None, u: dict, route: str, status: int, body: dict) -> None:
        if key:
            db.run("INSERT OR IGNORE INTO idempotency(key,user_id,route,status_code,response,created_at) VALUES (?,?,?,?,?,?)",
                   key, u["id"], route, status, jdump(body), now())

    # ------------------------------------------------------------------ meta
    @endpoint
    async def health(request: Request) -> Response:
        db.one("SELECT 1 AS ok")
        return JSONResponse({"status": "ok", "time": now()})

    # ------------------------------------------------------------------ account (anonymous, per browser)
    @endpoint
    async def me(request: Request) -> Response:
        u = user_of(request)
        if request.method == "PATCH":
            b = await parse(request, S.ProfilePatch)
            for col, val in (("locale", b.locale), ("allow_training", None if b.allow_training is None else int(b.allow_training))):
                if val is not None:
                    db.run(f"UPDATE users SET {col}=? WHERE id=?", val, u["id"])
            u = db.one("SELECT * FROM users WHERE id=?", u["id"])
        elif request.method == "DELETE":
            await anyio.to_thread.run_sync(svc.delete_user, db, st, u["id"])      # erases every project and file of this browser
            return Response(status_code=204)
        return JSONResponse(svc.public_user(u))

    # ------------------------------------------------------------------ projects
    @endpoint
    async def projects(request: Request) -> Response:
        u = user_of(request)
        if request.method == "POST":
            b = await parse(request, S.ProjectCreate)
            pid = new_id("p_")
            db.run("INSERT INTO projects(id,user_id,name,language,retention_days,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
                   pid, u["id"], b.name, b.language, b.retention_days or st.default_retention_days, now(), now())
            return JSONResponse(svc.public_project(db.one("SELECT * FROM projects WHERE id=?", pid)), status_code=201)
        rows = db.all("SELECT * FROM projects WHERE user_id=? ORDER BY created_at DESC LIMIT 200", u["id"])
        return JSONResponse({"items": [svc.public_project(p, source_of(p["id"])) for p in rows]})

    @endpoint
    async def project(request: Request) -> Response:
        u = user_of(request)
        p = own_project(u, request.path_params["pid"])
        if request.method == "DELETE":
            await anyio.to_thread.run_sync(svc.delete_project, db, st, p["id"])
            return Response(status_code=204)
        out = svc.public_project(p, source_of(p["id"]))
        active = db.one("SELECT id FROM jobs WHERE project_id=? AND kind='analyze' AND status IN ('queued','running') ORDER BY created_at DESC", p["id"])
        out["active_job_id"] = active["id"] if active else None
        return JSONResponse(out)

    @endpoint
    async def upload_source(request: Request) -> Response:
        u = user_of(request)
        p = own_project(u, request.path_params["pid"])
        filename = Path(request.query_params.get("filename") or "video.mp4").name
        ext = Path(filename).suffix.lower()
        if ext not in ALLOWED_EXT:
            raise ApiError("UNSUPPORTED_MEDIA", {"allowed": sorted(ALLOWED_EXT)})
        limit = st.max_upload_mb * 1024 * 1024
        declared = int(request.headers.get("content-length") or 0)
        if declared > limit:
            raise ApiError("FILE_TOO_LARGE", {"max_mb": st.max_upload_mb})
        pdir = st.project_dir(p["id"])
        pdir.mkdir(parents=True, exist_ok=True)
        tmp = pdir / "upload.part"
        size = 0
        try:
            with open(tmp, "wb") as f:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > limit:
                        raise ApiError("FILE_TOO_LARGE", {"max_mb": st.max_upload_mb})
                    f.write(chunk)
            if size == 0:
                raise ApiError("UNSUPPORTED_MEDIA")
            info = await anyio.to_thread.run_sync(media.probe, str(tmp))
        except media.MediaError:
            tmp.unlink(missing_ok=True)
            raise ApiError("UNSUPPORTED_MEDIA") from None
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
        if info["duration"] > st.max_source_minutes * 60:
            tmp.unlink(missing_ok=True)
            raise ApiError("TOO_LONG", {"max_minutes": st.max_source_minutes})
        svc.install_source(db, st, p["id"], tmp, filename, size, info)
        return JSONResponse(svc.public_project(db.one("SELECT * FROM projects WHERE id=?", p["id"]), source_of(p["id"])), status_code=201)

    @endpoint
    async def import_source_url(request: Request) -> Response:
        """Queue a download of the source video from a public link (YouTube etc.); poll the returned job."""
        u = user_of(request)
        p = own_project(u, request.path_params["pid"])
        b = await parse(request, S.SourceUrl)
        try:
            url = await anyio.to_thread.run_sync(downloader.validate_url, b.url)
        except downloader.DownloadError as e:
            raise ApiError(e.code, e.detail) from None
        if not downloader.available():
            raise ApiError("DOWNLOAD_UNAVAILABLE")
        active = db.one("SELECT * FROM jobs WHERE project_id=? AND kind='import' AND status IN ('queued','running')", p["id"])
        if active:
            return JSONResponse(svc.public_job(active), status_code=200)
        job = create_job(u, "import", p["id"], {"url": url})
        audit(u["id"], "source.import_url", {"project": p["id"], "host": url.split("/")[2]})
        return JSONResponse(svc.public_job(job), status_code=202)

    @endpoint
    async def upload_subtitles(request: Request) -> Response:
        u = user_of(request)
        p = own_project(u, request.path_params["pid"])
        src = source_of(p["id"])
        if not src:
            raise ApiError("NO_SOURCE")
        raw = (await request.body()).decode("utf-8-sig", errors="replace")
        if len(raw) > 5_000_000:
            raise ApiError("FILE_TOO_LARGE")
        try:
            tr = parse_subtitles(raw, p["language"])
        except ValueError:
            tr = None
        if not tr or not tr.segments:
            raise ApiError("VALIDATION_ERROR", [{"field": "body", "message": "no valid SRT/VTT cues found"}])
        path = st.project_dir(p["id"]) / "subtitles.srt"
        path.write_text(raw, encoding="utf-8")
        db.run("UPDATE sources SET subtitles_path=? WHERE project_id=?", str(path), p["id"])
        for name in ("transcript.json", "suggestions.json"):  # stale artifacts of an older transcript
            (st.project_dir(p["id"]) / name).unlink(missing_ok=True)
        db.run("DELETE FROM suggestions WHERE project_id=?", p["id"])
        touch(p["id"], "ready")
        return JSONResponse({"cues": len(tr.segments), "duration": tr.duration})

    @endpoint
    async def source_media(request: Request) -> Response:
        u = user_of(request, allow_query_token=True)
        p = own_project(u, request.path_params["pid"])
        src = source_of(p["id"])
        if not src:
            raise ApiError("NO_SOURCE")
        proxy = st.project_dir(p["id"]) / "proxy.mp4"
        path = proxy if (request.query_params.get("kind") != "original" and proxy.exists()) else Path(src["path"])
        return FileResponse(path)

    @endpoint
    async def transcript(request: Request) -> Response:
        u = user_of(request)
        p = own_project(u, request.path_params["pid"])
        f = st.project_dir(p["id"]) / "transcript.json"
        if not f.exists():
            raise ApiError("NOT_READY")
        tr = Transcript.from_dict(json.loads(f.read_text(encoding="utf-8")))
        return JSONResponse({"language": tr.language, "engine": tr.engine, "avg_confidence": round(tr.avg_conf, 3),
                             "segments": [s.to_dict() for s in tr.segments]})

    # ------------------------------------------------------------------ jobs
    def create_job(u: dict, kind: str, project_id: str | None, payload: dict) -> dict:
        jid = new_id("j_")
        db.run("INSERT INTO jobs(id,user_id,project_id,kind,payload,created_at) VALUES (?,?,?,?,?,?)",
               jid, u["id"], project_id, kind, jdump(payload), now())
        return db.one("SELECT * FROM jobs WHERE id=?", jid)

    @endpoint
    async def analyze(request: Request) -> Response:
        u = user_of(request)
        p = own_project(u, request.path_params["pid"])
        route = f"analyze:{p['id']}"
        key, replay = idempotent(request, u, route)
        if replay:
            return replay
        b = await parse(request, S.AnalyzeRequest)
        src = source_of(p["id"])
        if not src:
            raise ApiError("NO_SOURCE")
        active = db.one("SELECT * FROM jobs WHERE project_id=? AND kind='analyze' AND status IN ('queued','running')", p["id"])
        if active:
            return JSONResponse(svc.public_job(active), status_code=200)
        import os
        if not src["subtitles_path"] and os.getenv("ASR_PROVIDER", "").lower() == "none":
            raise ApiError("ASR_UNAVAILABLE")
        job = create_job(u, "analyze", p["id"], b.model_dump())
        touch(p["id"], "processing")
        body = svc.public_job(db.one("SELECT * FROM jobs WHERE id=?", job["id"]))
        remember(key, u, route, 202, body)
        return JSONResponse(body, status_code=202)

    @endpoint
    async def job(request: Request) -> Response:
        u = user_of(request)
        j = db.one("SELECT * FROM jobs WHERE id=? AND user_id=?", request.path_params["jid"], u["id"])
        if not j:
            raise ApiError("NOT_FOUND")
        if request.method == "DELETE":  # cancel a queued job
            n = db.run("UPDATE jobs SET status='canceled', finished_at=? WHERE id=? AND status='queued'", now(), j["id"])
            if n:
                if j["project_id"]:
                    touch(j["project_id"], "ready")
            j = db.one("SELECT * FROM jobs WHERE id=?", j["id"])
        return JSONResponse(svc.public_job(j))

    @endpoint
    async def job_events(request: Request) -> Response:
        u = user_of(request, allow_query_token=True)
        jid = request.path_params["jid"]
        if not db.one("SELECT id FROM jobs WHERE id=? AND user_id=?", jid, u["id"]):
            raise ApiError("NOT_FOUND")

        async def gen():
            last = None
            deadline = time.monotonic() + 900
            while time.monotonic() < deadline:
                j = db.one("SELECT * FROM jobs WHERE id=?", jid)
                if not j:
                    break
                payload = json.dumps(svc.public_job(j), ensure_ascii=False)
                if payload != last:
                    yield f"event: job\ndata: {payload}\n\n"
                    last = payload
                else:
                    yield ": keep-alive\n\n"
                if j["status"] in ("done", "error", "canceled"):
                    break
                if await request.is_disconnected():
                    break
                await asyncio.sleep(0.7)

        return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @endpoint
    async def suggestions(request: Request) -> Response:
        u = user_of(request)
        p = own_project(u, request.path_params["pid"])
        rows = db.all("SELECT * FROM suggestions WHERE project_id=? ORDER BY rank", p["id"])
        return JSONResponse({"items": [svc.public_suggestion(r) for r in rows]})

    # ------------------------------------------------------------------ clips
    def validated_edit_state(es_dict: dict, duration: float) -> dict:
        try:
            es = EditState.from_dict(es_dict)
            es.validate(duration)
        except (TypeError, ValueError) as e:
            raise ApiError("VALIDATION_ERROR", [{"field": "edit_state", "message": str(e)}]) from None
        d = es.to_dict()
        d["split_centers"] = list(d["split_centers"]) if d.get("split_centers") else None
        return d

    @endpoint
    async def clips(request: Request) -> Response:
        u = user_of(request)
        p = own_project(u, request.path_params["pid"])
        if request.method == "POST":
            b = await parse(request, S.ClipCreate)
            src = source_of(p["id"])
            if not src:
                raise ApiError("NO_SOURCE")
            title, emphasis = b.title or "", []
            if b.suggestion_id:
                s = db.one("SELECT * FROM suggestions WHERE id=? AND project_id=?", b.suggestion_id, p["id"])
                if not s:
                    raise ApiError("NOT_FOUND")
                d = jload(s["data"], {})
                start, end, title, emphasis = d["start"], d["end"], title or d.get("title", ""), d.get("emphasis", [])
            elif b.start is not None and b.end is not None:
                start, end = b.start, b.end
            else:
                raise ApiError("VALIDATION_ERROR", [{"field": "suggestion_id", "message": "provide suggestion_id or start+end"}])
            es = validated_edit_state({"start": start, "end": end, "caption": {"emphasis": emphasis}}, src["duration"])
            cid = new_id("c_")
            db.run("INSERT INTO clips(id,project_id,user_id,suggestion_id,title,edit_state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
                   cid, p["id"], u["id"], b.suggestion_id, title, jdump(es), now(), now())
            touch(p["id"])
            return JSONResponse(svc.public_clip(db.one("SELECT * FROM clips WHERE id=?", cid)), status_code=201)
        rows = db.all("SELECT * FROM clips WHERE project_id=? ORDER BY created_at", p["id"])
        return JSONResponse({"items": [svc.public_clip(c) for c in rows]})

    @endpoint
    async def clip(request: Request) -> Response:
        u = user_of(request)
        c = own_clip(u, request.path_params["cid"])
        if request.method == "DELETE":
            for e in db.all("SELECT path FROM exports WHERE clip_id=?", c["id"]):
                if e["path"]:
                    Path(e["path"]).unlink(missing_ok=True)
            db.run("DELETE FROM clips WHERE id=?", c["id"])
            return Response(status_code=204)
        if request.method == "PATCH":
            im = request.headers.get("if-match")
            if im is None:
                raise ApiError("PRECONDITION_REQUIRED")
            if im.strip('"') != str(c["version"]):
                raise ApiError("VERSION_CONFLICT", {"current_version": c["version"]})
            b = await parse(request, S.ClipPatch)
            es = jload(c["edit_state"], {})
            if b.edit_state:
                patch = dict(b.edit_state)
                if isinstance(patch.get("caption"), dict):
                    patch["caption"] = {**es.get("caption", {}), **patch["caption"]}
                es = {**es, **patch}
            src = source_of(c["project_id"])
            es = validated_edit_state(es, src["duration"] if src else None)
            n = db.run("UPDATE clips SET edit_state=?, title=?, version=version+1, updated_at=? WHERE id=? AND version=?",
                       jdump(es), b.title if b.title is not None else c["title"], now(), c["id"], c["version"])
            if not n:
                raise ApiError("VERSION_CONFLICT")
            c = db.one("SELECT * FROM clips WHERE id=?", c["id"])
        out = svc.public_clip(c)
        return JSONResponse(out, headers={"ETag": f'"{c["version"]}"'})

    # ------------------------------------------------------------------ exports
    @endpoint
    async def create_export(request: Request) -> Response:
        u = user_of(request)
        c = own_clip(u, request.path_params["cid"])
        route = f"export:{c['id']}"
        key, replay = idempotent(request, u, route)
        if replay:
            return replay
        b = await parse(request, S.ExportCreate)
        eid = new_id("e_")
        job = create_job(u, "export", c["project_id"], {"export_id": eid, "clip_id": c["id"]})
        db.run("INSERT INTO exports(id,clip_id,user_id,job_id,resolution,edit_version,created_at) VALUES (?,?,?,?,?,?,?)",
               eid, c["id"], u["id"], job["id"], b.resolution, c["version"], now())
        body = {"export": svc.public_export(db.one("SELECT * FROM exports WHERE id=?", eid)), "job": svc.public_job(job)}
        remember(key, u, route, 202, body)
        return JSONResponse(body, status_code=202)

    @endpoint
    async def export_item(request: Request) -> Response:
        u = user_of(request, allow_query_token=True)
        e = db.one("SELECT * FROM exports WHERE id=? AND user_id=?", request.path_params["eid"], u["id"])
        if not e:
            raise ApiError("NOT_FOUND")
        if request.url.path.endswith("/file"):
            if e["status"] != "done" or not e["path"] or not Path(e["path"]).exists():
                raise ApiError("EXPIRED" if e["status"] == "expired" else "NOT_READY")
            dl = request.query_params.get("download") == "1"
            return FileResponse(e["path"], media_type="video/mp4", filename=(f"cliparab-{e['id']}.mp4" if dl else None),
                                content_disposition_type="attachment" if dl else "inline")
        if request.method == "DELETE":
            if e["path"]:
                Path(e["path"]).unlink(missing_ok=True)
            db.run("DELETE FROM exports WHERE id=?", e["id"])
            return Response(status_code=204)
        return JSONResponse(svc.public_export(e))

    @endpoint
    async def clip_exports(request: Request) -> Response:
        u = user_of(request)
        c = own_clip(u, request.path_params["cid"])
        rows = db.all("SELECT * FROM exports WHERE clip_id=? ORDER BY created_at DESC", c["id"])
        return JSONResponse({"items": [svc.public_export(e) for e in rows]})

    # ------------------------------------------------------------------ review links (public, comment-only)
    @endpoint
    async def create_review_link(request: Request) -> Response:
        u = user_of(request)
        c = own_clip(u, request.path_params["cid"])
        b = await parse(request, S.ReviewLinkCreate)
        token = secrets.token_urlsafe(24)
        exp = (datetime.now(timezone.utc) + timedelta(hours=b.expires_in_hours)).isoformat(timespec="seconds")
        db.run("INSERT INTO review_links(token,clip_id,created_by,allow_comments,expires_at,created_at) VALUES (?,?,?,?,?,?)",
               token, c["id"], u["id"], int(b.allow_comments), exp, now())
        return JSONResponse({"token": token, "path": f"/review/{token}", "expires_at": exp}, status_code=201)

    def link_of(token: str) -> dict:
        l = db.one("SELECT * FROM review_links WHERE token=?", token)
        if not l:
            raise ApiError("NOT_FOUND")
        if l["expires_at"] < now():
            raise ApiError("EXPIRED")
        return l

    def latest_export(clip_id: str) -> dict | None:
        return db.one("SELECT * FROM exports WHERE clip_id=? AND status='done' ORDER BY created_at DESC LIMIT 1", clip_id)

    @endpoint
    async def review(request: Request) -> Response:
        ctx.rate_limit("ip:" + (request.client.host if request.client else "?"))
        l = link_of(request.path_params["token"])
        c = db.one("SELECT * FROM clips WHERE id=?", l["clip_id"])
        e = latest_export(c["id"])
        if request.url.path.endswith("/file"):
            if not e or not e["path"] or not Path(e["path"]).exists():
                raise ApiError("NOT_READY")
            return FileResponse(e["path"], media_type="video/mp4")
        if request.url.path.endswith("/comments") and request.method == "POST":
            if not l["allow_comments"]:
                raise ApiError("FORBIDDEN")
            b = await parse(request, S.CommentCreate)
            cid = new_id("cm_")
            db.run("INSERT INTO comments(id,clip_id,author,body,at_seconds,created_at) VALUES (?,?,?,?,?,?)",
                   cid, c["id"], b.author, b.body, b.at_seconds, now())
            return JSONResponse({"id": cid}, status_code=201)
        comments = db.all("SELECT id,author,body,at_seconds,created_at FROM comments WHERE clip_id=? ORDER BY created_at", c["id"])
        return JSONResponse({"title": c["title"], "has_video": bool(e), "allow_comments": bool(l["allow_comments"]),
                             "comments": comments, "video_url": f"/v1/review/{l['token']}/file" if e else None})

    @endpoint
    async def clip_comments(request: Request) -> Response:
        u = user_of(request)
        c = own_clip(u, request.path_params["cid"])
        return JSONResponse({"items": db.all("SELECT id,author,body,at_seconds,created_at FROM comments WHERE clip_id=? ORDER BY created_at", c["id"])})

    return [
        Route("/healthz", health),
        Route("/v1/me", me, methods=["GET", "PATCH", "DELETE"]),
        Route("/v1/projects", projects, methods=["GET", "POST"]),
        Route("/v1/projects/{pid}", project, methods=["GET", "DELETE"]),
        Route("/v1/projects/{pid}/source", upload_source, methods=["POST"]),
        Route("/v1/projects/{pid}/source-url", import_source_url, methods=["POST"]),
        Route("/v1/projects/{pid}/subtitles", upload_subtitles, methods=["PUT", "POST"]),
        Route("/v1/projects/{pid}/media", source_media, methods=["GET"]),
        Route("/v1/projects/{pid}/transcript", transcript, methods=["GET"]),
        Route("/v1/projects/{pid}/analyze", analyze, methods=["POST"]),
        Route("/v1/projects/{pid}/suggestions", suggestions, methods=["GET"]),
        Route("/v1/projects/{pid}/clips", clips, methods=["GET", "POST"]),
        Route("/v1/jobs/{jid}", job, methods=["GET", "DELETE"]),
        Route("/v1/jobs/{jid}/events", job_events, methods=["GET"]),
        Route("/v1/clips/{cid}", clip, methods=["GET", "PATCH", "DELETE"]),
        Route("/v1/clips/{cid}/exports", create_export, methods=["POST"]),
        Route("/v1/clips/{cid}/exports/list", clip_exports, methods=["GET"]),
        Route("/v1/clips/{cid}/comments", clip_comments, methods=["GET"]),
        Route("/v1/clips/{cid}/review-links", create_review_link, methods=["POST"]),
        Route("/v1/exports/{eid}", export_item, methods=["GET", "DELETE"]),
        Route("/v1/exports/{eid}/file", export_item, methods=["GET"]),
        Route("/v1/review/{token}", review, methods=["GET"]),
        Route("/v1/review/{token}/file", review, methods=["GET"]),
        Route("/v1/review/{token}/comments", review, methods=["POST"]),
    ]
