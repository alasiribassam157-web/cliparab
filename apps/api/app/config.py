from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("DATA_DIR", "./data")))
    cors_origins: list[str] = field(default_factory=lambda: [o for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o])
    max_upload_mb: int = field(default_factory=lambda: int(os.getenv("MAX_UPLOAD_MB", "2048")))
    max_source_minutes: int = field(default_factory=lambda: int(os.getenv("MAX_SOURCE_MINUTES", "180")))
    rate_limit_per_min: int = field(default_factory=lambda: int(os.getenv("RATE_LIMIT_PER_MIN", "240")))
    default_retention_days: int = field(default_factory=lambda: int(os.getenv("RETENTION_DAYS", "30")))
    export_ttl_hours: int = field(default_factory=lambda: int(os.getenv("EXPORT_TTL_HOURS", "72")))

    def __post_init__(self) -> None:
        self.data_dir = Path(self.data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)

    @property
    def db_path(self) -> Path:
        return self.data_dir / "cliparab.db"

    def project_dir(self, project_id: str) -> Path:
        return self.data_dir / "projects" / project_id

    def export_dir(self) -> Path:
        d = self.data_dir / "exports"
        d.mkdir(parents=True, exist_ok=True)
        return d
