"use client";

/**
 * A real suggested clip, playing live in a phone frame: the source video cropped to 9:16 around the speaker,
 * looping inside the clip's range, with the same karaoke Arabic captions as the editor. Muted autoplay while
 * on screen; tap to hear it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { captionAt, chunkWords } from "@/lib/captions";
import type { WordT } from "@/lib/types";

interface Props {
  src: string;
  start: number;
  end: number;
  center: number;
  aspect: number;
  words: WordT[];
  emphasis: string[];
  title: string;
  score: number;
}

export function ShowcasePhone({ src, start, end, center, aspect, words, emphasis, title, score }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [time, setTime] = useState(start);
  const [muted, setMuted] = useState(true);
  const events = useMemo(() => chunkWords(words.filter((w) => w.end > start && w.start < end), 22), [words, start, end]);
  const active = captionAt(events, time, "karaoke", emphasis, 22);

  // play only while visible (three HD streams at once would waste the visitor's data)
  useEffect(() => {
    const v = ref.current, el = box.current;
    if (!v || !el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { if (v.currentTime < start || v.currentTime > end) v.currentTime = start; void v.play().catch(() => {}); }
      else v.pause();
    }, { threshold: 0.35 });
    io.observe(el);
    let raf = 0;
    const loop = () => {
      if (v.currentTime >= end || v.currentTime < start - 0.5) v.currentTime = start;
      setTime(v.currentTime);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [start, end]);

  const boxW = 9 / 16;
  const p = aspect > boxW ? Math.min(1, Math.max(0, (center * aspect - boxW / 2) / (aspect - boxW))) : 0.5;

  return (
    <div className="showcase-item" ref={box}>
      <button type="button" className="phone showcase-phone" style={{ containerType: "inline-size" }} onClick={() => setMuted((m) => !m)} aria-label={title}>
        <div className="fill">
          <video ref={ref} src={`${src}#t=${start.toFixed(2)}`} muted={muted} playsInline preload="metadata" style={{ objectPosition: `${(p * 100).toFixed(1)}% 50%` }} />
        </div>
        {active && (
          <div className="cap bottom" style={{ fontSize: "calc(74 / 1080 * 100cqw)", color: "#fff" }} dir="rtl">
            {active.lines.map((line, i) => (
              <span className="line" key={i}>
                {line.map((x, j) => (
                  <span key={j} className="w" style={{ color: x.spoken || x.emphasis ? "#FFD21F" : undefined }}>{x.w.text}{" "}</span>
                ))}
              </span>
            ))}
          </div>
        )}
        <span className="showcase-sound" aria-hidden>{muted ? "🔇" : "🔊"}</span>
        <span className="showcase-score" aria-hidden>{Math.round(score)}</span>
      </button>
      <p className="showcase-title">{title}</p>
    </div>
  );
}
