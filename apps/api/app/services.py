from __future__ import annotations

import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .config import PLANS, Settings
from .db import Db, jload, new_id, now
from .errors import ApiError


# ---------------------------------------------------------------- credits (ledger)
def month_start() -> str:
    n = datetime.now(timezone.utc)
    return n.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat(timespec="seconds")


def remaining_minutes(db: Db, user: dict) -> float:
    grant = PLANS.get(user["plan"], PLANS["free"])["minutes"]
    row = db.one("SELECT COALESCE(SUM(delta_minutes), 0) AS s FROM credits WHERE user_id=? AND created_at>=?",
                 user["id"], month_start())
    return round(grant + row["s"], 2)


def reserve_minutes(db: Db, user: dict, minutes: float, ref: str) -> float:
    """Reserve atomically; the ledger insert and the balance check share one transaction."""
    grant = PLANS.get(user["plan"], PLANS["free"])["minutes"]
    with db.tx() as c:
        s = c.execute("SELECT COALESCE(SUM(delta_minutes), 0) FROM credits WHERE user_id=? AND created_at>=?",
                      (user["id"], month_start())).fetchone()[0]
        remaining = grant + s
        if remaining + 1e-9 < minutes:
            raise ApiError("QUOTA_EXCEEDED", {"needed_minutes": round(minutes, 2), "remaining_minutes": round(remaining, 2)})
        c.execute("INSERT INTO credits(id,user_id,delta_minutes,reason,ref,created_at) VALUES (?,?,?,?,?,?)",
                  (new_id("cr_"), user["id"], -minutes, "analyze", ref, now()))
    return minutes


def refund_minutes(db: Db, user_id: str, minutes: float, ref: str) -> None:
    if minutes > 0:
        db.run("INSERT INTO credits(id,user_id,delta_minutes,reason,ref,created_at) VALUES (?,?,?,?,?,?)",
               new_id("cr_"), user_id, minutes, "refund", ref, now())


# ---------------------------------------------------------------- serializers
def public_user(u: dict, db: Db) -> dict:
    plan = PLANS.get(u["plan"], PLANS["free"])
    return {"id": u["id"], "email": u["email"], "name": u["name"], "locale": u["locale"], "plan": u["plan"],
            "allow_training": bool(u["allow_training"]), "created_at": u["created_at"],
            "minutes_remaining": remaining_minutes(db, u), "minutes_monthly": plan["minutes"], "watermark": plan["watermark"]}


def public_project(p: dict, source: dict | None = None) -> dict:
    out = {k: p[k] for k in ("id", "name", "language", "status", "retention_days", "created_at", "updated_at")}
    out["source"] = None if not source else {
        "filename": source["filename"], "duration": source["duration"], "width": source["width"],
        "height": source["height"], "size_bytes": source["size_bytes"], "has_subtitles": bool(source["subtitles_path"])}
    return out


def public_job(j: dict) -> dict:
    err = None
    if j["error_code"]:
        err = {"code": j["error_code"], "message_ar": j["error_message_ar"], "message_en": j["error_message_en"]}
    return {"id": j["id"], "kind": j["kind"], "status": j["status"], "progress": round(j["progress"], 3), "stage": j["stage"],
            "project_id": j["project_id"], "result": jload(j["result"]), "error": err, "created_at": j["created_at"],
            "started_at": j["started_at"], "finished_at": j["finished_at"]}


def public_clip(c: dict) -> dict:
    return {"id": c["id"], "project_id": c["project_id"], "suggestion_id": c["suggestion_id"], "title": c["title"],
            "edit_state": jload(c["edit_state"], {}), "version": c["version"], "created_at": c["created_at"], "updated_at": c["updated_at"]}


def public_export(e: dict) -> dict:
    return {"id": e["id"], "clip_id": e["clip_id"], "status": e["status"], "job_id": e["job_id"], "resolution": e["resolution"],
            "size_bytes": e["size_bytes"], "duration": e["duration"], "edit_version": e["edit_version"],
            "created_at": e["created_at"], "expires_at": e["expires_at"], "download_url": f"/v1/exports/{e['id']}/file" if e["status"] == "done" else None}


def public_suggestion(s: dict) -> dict:
    d = jload(s["data"], {})
    d["id"] = s["id"]
    d["rank"] = s["rank"]
    return d


# ---------------------------------------------------------------- deletion / retention
def _rm_tree(p: Path) -> None:
    shutil.rmtree(p, ignore_errors=True)


def delete_project(db: Db, settings: Settings, project_id: str) -> None:
    """Hard delete: files first, then rows (cascade). No soft-delete copies are kept."""
    for e in db.all("SELECT e.path FROM exports e JOIN clips c ON c.id=e.clip_id WHERE c.project_id=?", project_id):
        if e["path"]:
            Path(e["path"]).unlink(missing_ok=True)
    _rm_tree(settings.project_dir(project_id))
    db.run("DELETE FROM projects WHERE id=?", project_id)


def delete_user(db: Db, settings: Settings, user_id: str) -> None:
    for p in db.all("SELECT id FROM projects WHERE user_id=?", user_id):
        delete_project(db, settings, p["id"])
    db.run("INSERT INTO audit_logs(id,user_id,action,meta,created_at) VALUES (?,?,?,?,?)", new_id("a_"), None, "user.deleted", user_id, now())
    db.run("DELETE FROM users WHERE id=?", user_id)


def purge_expired(db: Db, settings: Settings) -> dict:
    """Delete projects past their retention window and expired export files."""
    n_projects = n_exports = 0
    for p in db.all("SELECT id, retention_days, updated_at FROM projects"):
        updated = datetime.fromisoformat(p["updated_at"])
        if datetime.now(timezone.utc) - updated > timedelta(days=p["retention_days"]):
            delete_project(db, settings, p["id"])
            n_projects += 1
    for e in db.all("SELECT id, path FROM exports WHERE expires_at IS NOT NULL AND expires_at < ? AND status='done'", now()):
        if e["path"]:
            Path(e["path"]).unlink(missing_ok=True)
        db.run("UPDATE exports SET status='expired', path=NULL WHERE id=?", e["id"])
        n_exports += 1
    db.run("DELETE FROM idempotency WHERE created_at < ?", (datetime.now(timezone.utc) - timedelta(days=2)).isoformat(timespec="seconds"))
    return {"projects": n_projects, "exports": n_exports}


# ---------------------------------------------------------------- sources
def install_source(db: Db, settings: Settings, project_id: str, tmp: Path, filename: str, size: int, info: dict) -> None:
    """Make ``tmp`` the project's source (replacing any old one and everything derived from it)."""
    pdir = settings.project_dir(project_id)
    old = db.one("SELECT * FROM sources WHERE project_id=?", project_id)
    if old:  # replacing the source invalidates every derived artifact
        Path(old["path"]).unlink(missing_ok=True)
        for f in pdir.iterdir():
            if f.name not in ("upload.part",) and f.is_file() and f != tmp:
                f.unlink(missing_ok=True)
        db.run("DELETE FROM suggestions WHERE project_id=?", project_id)
        db.run("DELETE FROM sources WHERE project_id=?", project_id)
    final = pdir / f"source{Path(filename).suffix.lower()}"
    tmp.replace(final)
    db.run("INSERT INTO sources(id,project_id,filename,path,size_bytes,duration,width,height,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
           new_id("s_"), project_id, filename, str(final), size, info["duration"], info["width"], info["height"], now())
    db.run("UPDATE projects SET status='ready', updated_at=? WHERE id=?", now(), project_id)
