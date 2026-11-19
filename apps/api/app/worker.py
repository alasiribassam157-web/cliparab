"""Job worker: polls the ``jobs`` table (atomic claim) and runs analyze / export jobs.

Run several copies to scale out: ``cliparab-worker`` (each process handles one job at a time).
Jobs are idempotent (pipeline stages persist their output), so a crashed job is simply re-queued.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import signal
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cliparab_core import media
from cliparab_core.models import Transcript
from cliparab_core.pipeline import AnalyzeOptions, Project, analyze
from cliparab_core.providers import get_llm, get_transcriber
from cliparab_core.render import EditState, render_clip

from . import services as svc
from .config import Settings
from .db import Db, jdump, jload, new_id, now
from .errors import ApiError

log = logging.getLogger("cliparab.worker")
STALE_AFTER = timedelta(minutes=45)
MAX_ATTEMPTS = 3


# ---------------------------------------------------------------- queue primitives
def claim(db: Db) -> dict | None:
    with db.tx() as c:
        row = c.execute("SELECT id FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1").fetchone()
        if not row:
            return None
        c.execute("UPDATE jobs SET status='running', started_at=?, attempts=attempts+1, progress=0, stage='starting' WHERE id=?",
                  (now(), row["id"]))
    return db.one("SELECT * FROM jobs WHERE id=?", row["id"])


def reap_stale(db: Db) -> int:
    """Re-queue (or fail) jobs whose worker died mid-run."""
    cutoff = (datetime.now(timezone.utc) - STALE_AFTER).isoformat(timespec="seconds")
    n = 0
    for j in db.all("SELECT * FROM jobs WHERE status='running' AND started_at < ?", cutoff):
        if j["attempts"] >= MAX_ATTEMPTS:
            fail(db, j, "INTERNAL")
        else:
            db.run("UPDATE jobs SET status='queued' WHERE id=?", j["id"])
        n += 1
    return n


def set_progress(db: Db, job_id: str, progress: float, stage: str | None = None) -> None:
    if stage is None:
        db.run("UPDATE jobs SET progress=? WHERE id=?", min(max(progress, 0), 1), job_id)
    else:
        db.run("UPDATE jobs SET progress=?, stage=? WHERE id=?", min(max(progress, 0), 1), stage, job_id)


def finish(db: Db, job: dict, result: dict) -> None:
    db.run("UPDATE jobs SET status='done', progress=1, stage='done', result=?, finished_at=? WHERE id=?", jdump(result), now(), job["id"])


def fail(db: Db, job: dict, code: str, details: str | None = None) -> None:
    err = ApiError(code)
    db.run("UPDATE jobs SET status='error', error_code=?, error_message_ar=?, error_message_en=?, finished_at=? WHERE id=?",
           code, err.message_ar, err.message_en + (f" ({details})" if details else ""), now(), job["id"])
    svc.refund_minutes(db, job["user_id"], job["credits_reserved"], job["id"])  # failed work is never charged
    if job["project_id"] and job["kind"] == "analyze":
        db.run("UPDATE projects SET status='ready', updated_at=? WHERE id=?", now(), job["project_id"])
    if job["kind"] == "export":
        eid = jload(job["payload"], {}).get("export_id")
        if eid:
            db.run("UPDATE exports SET status='error' WHERE id=?", eid)


# ---------------------------------------------------------------- handlers
STAGE_RANGE = {"probe": (0.02, "قراءة الفيديو"), "transcribe": (0.05, "تفريغ الكلام"), "segment": (0.55, "فهم السياق"),
               "score": (0.65, "تقييم المقاطع"), "done": (0.97, "اكتمل")}


def handle_analyze(db: Db, st: Settings, job: dict) -> None:
    payload = jload(job["payload"], {})
    p = db.one("SELECT * FROM projects WHERE id=?", job["project_id"])
    src = db.one("SELECT * FROM sources WHERE project_id=?", job["project_id"])
    if not p or not src:
        return fail(db, job, "NOT_FOUND")
    project = Project(st.project_dir(p["id"]))
    transcriber = None
    if not src["subtitles_path"]:
        try:
            transcriber = get_transcriber()
        except (ImportError, RuntimeError, ValueError) as e:
            return fail(db, job, "ASR_UNAVAILABLE", str(e))
    opts = AnalyzeOptions(language=p["language"], max_clips=payload.get("max_clips", 8),
                          min_duration=payload.get("min_duration", 15), max_duration=payload.get("max_duration", 60))

    def progress(stage: str, frac: float) -> None:
        base, label = STAGE_RANGE.get(stage, (frac, stage))
        set_progress(db, job["id"], base, label)

    try:
        llm = get_llm()
        clips = analyze(src["path"], project, transcriber=transcriber, subtitles=src["subtitles_path"], llm=llm, opts=opts, progress=progress)
        try:  # a light proxy makes editor preview fast; failure here must not fail the job
            proxy = project.path("proxy.mp4")
            if not proxy.exists():
                set_progress(db, job["id"], 0.97, "تجهيز المعاينة")
                media.make_proxy(src["path"], str(proxy))
        except media.MediaError:
            log.warning("proxy creation failed for %s", p["id"])
    except media.MediaError as e:
        return fail(db, job, "UNSUPPORTED_MEDIA", str(e)[:200])
    except ValueError as e:
        return fail(db, job, "NO_SPEECH" if "empty" in str(e) else "VALIDATION_ERROR", str(e)[:200])
    except (ImportError, RuntimeError) as e:
        if "not installed" in str(e) or "API key" in str(e) or "api_key" in str(e).lower():
            return fail(db, job, "ASR_UNAVAILABLE", str(e)[:200])
        log.exception("analyze failed")
        return fail(db, job, "INTERNAL", type(e).__name__)
    except Exception as e:  # noqa: BLE001
        log.exception("analyze failed")
        return fail(db, job, "INTERNAL", type(e).__name__)

    rows = project.load("suggestions.json")
    with db.tx() as c:
        c.execute("DELETE FROM suggestions WHERE project_id=?", (p["id"],))
        for d in rows:
            c.execute("INSERT INTO suggestions(id,project_id,rank,data,created_at) VALUES (?,?,?,?,?)",
                      (new_id("sg_"), p["id"], d["rank"], jdump(d), now()))
        c.execute("UPDATE projects SET status='done', updated_at=? WHERE id=?", (now(), p["id"]))
    tr = project.load("transcript.json")
    finish(db, job, {"suggestions": len(rows), "engine": rows[0]["engine"] if rows else None,
                     "transcript_engine": tr.get("engine"), "language": tr.get("language")})


def handle_export(db: Db, st: Settings, job: dict) -> None:
    payload = jload(job["payload"], {})
    e = db.one("SELECT * FROM exports WHERE id=?", payload.get("export_id"))
    c = db.one("SELECT * FROM clips WHERE id=?", payload.get("clip_id"))
    src = db.one("SELECT * FROM sources WHERE project_id=?", job["project_id"])
    if not (e and c and src):
        return fail(db, job, "NOT_FOUND")
    db.run("UPDATE exports SET status='running' WHERE id=?", e["id"])
    es = EditState.from_dict({**jload(c["edit_state"], {}), "resolution": e["resolution"]})
    project = Project(st.project_dir(c["project_id"]))
    words = Transcript.from_dict(project.load("transcript.json")).words() if project.has("transcript.json") else []
    out = st.export_dir() / f"{e['id']}.mp4"
    last = [0.0]

    def on_progress(frac: float) -> None:
        if frac - last[0] >= 0.03 or frac >= 1.0:
            last[0] = frac
            set_progress(db, job["id"], 0.05 + 0.93 * frac, "تصيير الفيديو")

    try:
        info = render_clip(src["path"], es, words, str(out), str(project.path(f"render_{e['id']}")), on_progress=on_progress)
    except media.MediaError as ex:
        return fail(db, job, "INTERNAL", str(ex)[:300])
    except ValueError as ex:
        return fail(db, job, "VALIDATION_ERROR", str(ex))
    except Exception as ex:  # noqa: BLE001
        log.exception("export failed")
        return fail(db, job, "INTERNAL", type(ex).__name__)
    expires = (datetime.now(timezone.utc) + timedelta(hours=st.export_ttl_hours)).isoformat(timespec="seconds")
    db.run("UPDATE exports SET status='done', path=?, size_bytes=?, duration=?, expires_at=? WHERE id=?",
           str(out), Path(out).stat().st_size, info["duration"], expires, e["id"])
    finish(db, job, {"export_id": e["id"], "duration": info["duration"], "width": info["width"], "height": info["height"]})


HANDLERS = {"analyze": handle_analyze, "export": handle_export}


def run_one(db: Db, st: Settings) -> bool:
    """Claim and run one job. Returns False when the queue is empty."""
    job = claim(db)
    if not job:
        return False
    log.info("job %s (%s) started", job["id"], job["kind"])
    try:
        HANDLERS[job["kind"]](db, st, job)
    except Exception as e:  # noqa: BLE001
        log.exception("job %s crashed", job["id"])
        fail(db, job, "INTERNAL", type(e).__name__)
    return True


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="drain the queue and exit")
    ap.add_argument("--poll", type=float, default=float(os.getenv("WORKER_POLL_SECONDS", "1.5")))
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    st = Settings()
    db = Db(st.db_path)
    stop = {"flag": False}
    signal.signal(signal.SIGTERM, lambda *_: stop.update(flag=True))
    signal.signal(signal.SIGINT, lambda *_: stop.update(flag=True))
    last_maint = 0.0
    while not stop["flag"]:
        if time.monotonic() - last_maint > 3600 or last_maint == 0.0:
            reap_stale(db)
            log.info("retention sweep: %s", svc.purge_expired(db, st))
            last_maint = time.monotonic()
        if not run_one(db, st):
            if args.once:
                break
            time.sleep(args.poll)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
