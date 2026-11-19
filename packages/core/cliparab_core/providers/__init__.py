"""Pluggable providers.

Selection is by name (usually an env var), so the pipeline never imports a heavy
dependency unless that provider is actually used:

- transcription: ``faster-whisper`` (local), ``openai-whisper`` (API), ``subtitles`` (import)
- llm: ``claude`` (Anthropic API) or ``heuristic`` (offline fallback)
"""

from __future__ import annotations

from .base import LLMProvider, Transcriber
from .heuristic import HeuristicLLM
from .llm_claude import ClaudeLLM


def get_llm(name: str | None = None, **kw) -> LLMProvider:
    import os

    name = (name or os.getenv("LLM_PROVIDER") or "").lower()
    if not name:
        name = "claude" if os.getenv("ANTHROPIC_API_KEY") else "heuristic"
    if name == "claude":
        return ClaudeLLM(**kw)
    if name == "heuristic":
        return HeuristicLLM()
    raise ValueError(f"unknown LLM provider: {name}")


def get_transcriber(name: str | None = None, **kw) -> Transcriber:
    import os

    name = (name or os.getenv("ASR_PROVIDER") or "faster-whisper").lower()
    if name in ("faster-whisper", "local"):
        from .asr_local import FasterWhisperTranscriber

        return FasterWhisperTranscriber(**kw)
    if name in ("openai-whisper", "openai"):
        from .asr_openai import OpenAIWhisperTranscriber

        return OpenAIWhisperTranscriber(**kw)
    raise ValueError(f"unknown ASR provider: {name}")


__all__ = ["LLMProvider", "Transcriber", "HeuristicLLM", "ClaudeLLM", "get_llm", "get_transcriber"]
