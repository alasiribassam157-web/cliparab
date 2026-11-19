"""SQLite storage (stdlib). One short-lived connection per call keeps it safe across the API and worker processes.

The schema mirrors ``db/schema.sql`` (PostgreSQL target) with portable types: ids are TEXT UUIDs,
JSON documents are TEXT. Moving to PostgreSQL means re-implementing this thin ``Db`` class.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '', pw_hash TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'ar', plan TEXT NOT NULL DEFAULT 'free',
  allow_training INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'ar', status TEXT NOT NULL DEFAULT 'empty', retention_days INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS projects_user ON projects(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  filename TEXT NOT NULL, path TEXT NOT NULL, size_bytes INTEGER NOT NULL, duration REAL NOT NULL,
  width INTEGER, height INTEGER, subtitles_path TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', progress REAL NOT NULL DEFAULT 0, stage TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}', result TEXT, error_code TEXT, error_message_ar TEXT, error_message_en TEXT,
  attempts INTEGER NOT NULL DEFAULT 0, credits_reserved REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT);
CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status, created_at);
CREATE TABLE IF NOT EXISTS suggestions (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, suggestion_id TEXT, title TEXT NOT NULL DEFAULT '',
  edit_state TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY, clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, job_id TEXT, status TEXT NOT NULL DEFAULT 'queued',
  path TEXT, size_bytes INTEGER, duration REAL, resolution TEXT, edit_version INTEGER,
  created_at TEXT NOT NULL, expires_at TEXT);
CREATE TABLE IF NOT EXISTS review_links (
  token TEXT PRIMARY KEY, clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, allow_comments INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY, clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  author TEXT NOT NULL, body TEXT NOT NULL, at_seconds REAL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS credits (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta_minutes REAL NOT NULL, reason TEXT NOT NULL, ref TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS credits_user ON credits(user_id, created_at);
CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT NOT NULL, user_id TEXT NOT NULL, route TEXT NOT NULL, status_code INTEGER NOT NULL, response TEXT NOT NULL,
  created_at TEXT NOT NULL, PRIMARY KEY (key, user_id, route));
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, meta TEXT, created_at TEXT NOT NULL);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id(prefix: str = "") -> str:
    return prefix + uuid.uuid4().hex[:20]


class Db:
    def __init__(self, path: str | Path):
        self.path = str(path)
        c = self._connect()
        try:
            c.executescript(SCHEMA)
        finally:
            c.close()

    def _connect(self) -> sqlite3.Connection:
        c = sqlite3.connect(self.path, timeout=15, isolation_level=None)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys=ON")
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA busy_timeout=15000")
        return c

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        c = self._connect()
        try:
            c.execute("BEGIN IMMEDIATE")
            yield c
            c.execute("COMMIT")
        except BaseException:
            if c.in_transaction:
                c.execute("ROLLBACK")
            raise
        finally:
            c.close()

    def one(self, sql: str, *params: Any) -> dict | None:
        c = self._connect()
        try:
            r = c.execute(sql, params).fetchone()
            return dict(r) if r else None
        finally:
            c.close()

    def all(self, sql: str, *params: Any) -> list[dict]:
        c = self._connect()
        try:
            return [dict(r) for r in c.execute(sql, params).fetchall()]
        finally:
            c.close()

    def run(self, sql: str, *params: Any) -> int:
        with self.tx() as c:
            return c.execute(sql, params).rowcount


def jdump(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False)


def jload(s: str | None, default: Any = None) -> Any:
    return json.loads(s) if s else default
