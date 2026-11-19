"""ClipArab core library.

Pure-Python (plus FFmpeg) building blocks used by the API workers and the CLI:

- ``models``      data classes shared by every stage
- ``subtitles``   SRT/VTT import and export
- ``text_ar``     Arabic text heuristics (sentence limits, dangling references, hooks)
- ``providers``   transcription and LLM providers (Whisper, Claude, heuristic fallback)
- ``candidates``  candidate clip generation with boundary repair
- ``scoring``     ClipScore, hard filters and diversification
- ``reframe``     face tracks to crop paths / split-screen layouts
- ``captions``    Arabic RTL ASS captions with word highlighting
- ``render``      FFmpeg rendering
- ``pipeline``    end-to-end orchestration
"""

__version__ = "0.1.0"
