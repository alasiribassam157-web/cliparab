from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

PLANS = {
    # monthly source-video minutes, max export resolution, max clips kept
    "free": {"minutes": 120, "resolution": "1080p", "watermark": False},
    "pro": {"minutes": 1200, "resolution": "1080p", "watermark": False},
}


@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("DATA_DIR", "./data")))
    secret: str = field(default_factory=lambda: os.getenv("APP_SECRET") or secrets.token_urlsafe(32))
    cors_origins: list[str] = field(default_factory=lambda: [o for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o])
    max_upload_mb: int = field(default_factory=lambda: int(os.getenv("MAX_UPLOAD_MB", "2048")))
    max_source_minutes: int = field(default_factory=lambda: int(os.getenv("MAX_SOURCE_MINUTES", "180")))
    token_ttl_hours: int = field(default_factory=lambda: int(os.getenv("TOKEN_TTL_HOURS", "168")))
    rate_limit_per_min: int = field(default_factory=lambda: int(os.getenv("RATE_LIMIT_PER_MIN", "240")))
    default_retention_days: int = field(default_factory=lambda: int(os.getenv("RETENTION_DAYS", "30")))
    export_ttl_hours: int = field(default_factory=lambda: int(os.getenv("EXPORT_TTL_HOURS", "72")))
    allow_registration: bool = field(default_factory=lambda: os.getenv("ALLOW_REGISTRATION", "1") == "1")

    def __post_init__(self) -> None:
        self.data_dir = Path(self.data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        if not os.getenv("APP_SECRET"):
            # Persist a generated secret so tokens survive restarts in dev.
            f = self.data_dir / ".secret"
            if f.exists():
                self.secret = f.read_text().strip()
            else:
                f.write_text(self.secret)
                f.chmod(0o600)

    @property
    def db_path(self) -> Path:
        return self.data_dir / "cliparab.db"

    def project_dir(self, project_id: str) -> Path:
        return self.data_dir / "projects" / project_id

    def export_dir(self) -> Path:
        d = self.data_dir / "exports"
        d.mkdir(parents=True, exist_ok=True)
        return d
