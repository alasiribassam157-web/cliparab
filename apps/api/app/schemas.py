from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, Field, field_validator

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class Register(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=200)
    name: str = Field(default="", max_length=120)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if not _EMAIL.match(v) or len(v) > 254:
            raise ValueError("invalid email")
        return v


class Login(BaseModel):
    email: str
    password: str


class ProfilePatch(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    locale: str | None = Field(default=None, pattern="^(ar|en)$")
    allow_training: bool | None = None


class DeleteAccount(BaseModel):
    password: str


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    language: str = Field(default="ar", pattern="^[a-z]{2,3}$")
    retention_days: int | None = Field(default=None, ge=1, le=365)


class SourceUrl(BaseModel):
    url: str = Field(min_length=8, max_length=2048)


class AnalyzeRequest(BaseModel):
    max_clips: int = Field(default=8, ge=1, le=20)
    min_duration: float = Field(default=15, ge=5, le=60)
    max_duration: float = Field(default=60, ge=15, le=90)


class ClipCreate(BaseModel):
    suggestion_id: str | None = None
    start: float | None = Field(default=None, ge=0)
    end: float | None = Field(default=None, ge=0)
    title: str | None = Field(default=None, max_length=160)


class ClipPatch(BaseModel):
    title: str | None = Field(default=None, max_length=160)
    edit_state: dict[str, Any] | None = None


class ExportCreate(BaseModel):
    resolution: str = Field(default="1080p", pattern="^(720p|1080p)$")


class ReviewLinkCreate(BaseModel):
    expires_in_hours: int = Field(default=168, ge=1, le=720)
    allow_comments: bool = True


class CommentCreate(BaseModel):
    author: str = Field(min_length=1, max_length=80)
    body: str = Field(min_length=1, max_length=2000)
    at_seconds: float | None = Field(default=None, ge=0)
