"""Command line: ``cliparab analyze|render|demo``."""

from __future__ import annotations

import argparse
import json
import sys

from .pipeline import AnalyzeOptions, Project, analyze, render
from .providers import get_llm, get_transcriber


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="cliparab")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("analyze", help="find the best clips in a video")
    a.add_argument("video")
    a.add_argument("--workdir", default="./cliparab-out")
    a.add_argument("--srt", help="use an existing .srt/.vtt instead of running ASR")
    a.add_argument("--asr", default=None, help="faster-whisper | openai-whisper")
    a.add_argument("--llm", default=None, help="claude | heuristic")
    a.add_argument("--max-clips", type=int, default=8)
    a.add_argument("--force", action="store_true")
    r = sub.add_parser("render", help="render one suggested clip")
    r.add_argument("video")
    r.add_argument("clip_id")
    r.add_argument("--workdir", default="./cliparab-out")
    r.add_argument("--layout", default="fill", choices=["fill", "fit", "split"])
    r.add_argument("--caption-style", default="karaoke", choices=["karaoke", "plain", "pop"])
    r.add_argument("--resolution", default="1080p", choices=["720p", "1080p"])
    args = ap.parse_args(argv)

    project = Project(args.workdir)
    if args.cmd == "analyze":
        tr = None if args.srt else get_transcriber(args.asr)
        clips = analyze(args.video, project, transcriber=tr, subtitles=args.srt, llm=get_llm(args.llm),
                        opts=AnalyzeOptions(max_clips=args.max_clips), force=args.force,
                        progress=lambda s, p: print(f"[{p:4.0%}] {s}", file=sys.stderr))
        for c in clips:
            print(f"#{c.total:5.1f}  {c.start:7.1f}-{c.end:7.1f}  [{c.clip_type}]  {c.title}")
        return 0
    if args.cmd == "render":
        res = render(args.video, project, args.clip_id,
                     {"layout": args.layout, "caption": {"mode": args.caption_style}, "resolution": args.resolution},
                     on_progress=lambda p: print(f"\rrender {p:4.0%}", end="", file=sys.stderr))
        print("\n" + json.dumps(res, ensure_ascii=False, indent=2))
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
