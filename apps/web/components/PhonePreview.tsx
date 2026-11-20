"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { captionAt, chunkWords } from "@/lib/captions";
import { clamp, fmtTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { EditState, WordT } from "@/lib/types";

interface Props {
  src: string;
  es: EditState;
  words: WordT[];
  aspect: number; // source width / height
}

/** HTML approximation of the final render (the FFmpeg output is authoritative). */
export function PhonePreview({ src, es, words, aspect }: Props) {
  const { t } = useI18n();
  const main = useRef<HTMLVideoElement>(null);
  const extra = useRef<(HTMLVideoElement | null)[]>([]);
  const [time, setTime] = useState(es.start);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);

  const cap = es.caption;
  const maxChars = 22;
  const events = useMemo(() => chunkWords(words, maxChars), [words]);
  const active = es.captions ? captionAt(events, time, cap.mode ?? "karaoke", cap.emphasis ?? [], maxChars) : null;

  // seek into range when the trim changes
  useEffect(() => {
    const v = main.current;
    if (v && (v.currentTime < es.start - 0.05 || v.currentTime > es.end)) v.currentTime = es.start;
    setTime((x) => clamp(x, es.start, es.end));
  }, [es.start, es.end]);

  // frame loop: loop inside [start,end], keep secondary videos in sync, drive captions
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const v = main.current;
      if (v) {
        if (v.currentTime >= es.end || v.currentTime < es.start - 0.1) v.currentTime = es.start;
        extra.current.forEach((x) => {
          if (!x) return;
          if (Math.abs(x.currentTime - v.currentTime) > 0.2) x.currentTime = v.currentTime;
          if (v.paused !== x.paused) { v.paused ? x.pause() : void x.play().catch(() => {}); }
        });
        setTime(v.currentTime);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [es.start, es.end]);

  const toggle = () => {
    const v = main.current;
    if (!v) return;
    if (v.paused) { if (v.currentTime >= es.end) v.currentTime = es.start; void v.play().then(() => setPlaying(true)).catch(() => {}); }
    else { v.pause(); setPlaying(false); }
  };

  const objPos = (cx: number) => {
    const imgW = aspect; // box height = 1
    const boxW = 9 / 16;
    const p = imgW > boxW ? clamp((cx * imgW - boxW / 2) / (imgW - boxW), 0, 1) : 0.5;
    return `${(p * 100).toFixed(1)}% 50%`;
  };
  const centers = (es.split_centers as unknown as [number, number] | null) ?? [0.25, 0.75];
  const baseColor = cap.color ?? "#FFFFFF";
  const hi = cap.highlight ?? "#FFD21F";
  const pos = cap.position ?? "bottom";
  const fs = cap.font_size ?? 74;

  const common = { muted, playsInline: true, preload: "auto" as const };
  return (
    <div className="phone-wrap">
      <div className="phone" style={{ containerType: "inline-size" }} data-testid="phone">
        {es.layout === "fill" && (
          <div className="fill">
            <video ref={main} src={src} {...common} style={{ objectPosition: objPos(es.reframe_mode === "manual" ? es.manual_center : es.reframe_mode === "auto" && typeof es.auto_center === "number" ? (es.auto_center as number) : 0.5) }} />
          </div>
        )}
        {es.layout === "fit" && (
          <div className="fit">
            <video className="bg" ref={(el) => { extra.current[0] = el; }} src={src} muted playsInline />
            <video className="fg" ref={main} src={src} {...common} />
          </div>
        )}
        {es.layout === "split" && (
          <div className="split">
            <div className="half"><video ref={main} src={src} {...common} style={{ objectPosition: objPos(centers[0]) }} /></div>
            <div className="half"><video ref={(el) => { extra.current[0] = el; }} src={src} muted playsInline style={{ objectPosition: objPos(centers[1]) }} /></div>
          </div>
        )}
        {active && (
          <div className={`cap ${pos}`} style={{ fontSize: `calc(${fs} / 1080 * 100cqw)`, color: baseColor, ...(cap.box ? { background: "rgba(0,0,0,.55)", borderRadius: "0.3em", padding: "0.1em 0.3em" } : {}) }} dir={active.lines.flat().some((x) => /[\u0600-\u06FF]/.test(x.w.text)) ? "rtl" : "ltr"} data-testid="caption">
            {active.lines.map((line, i) => (
              <span className="line" key={i}>
                {line.map((x, j) => (
                  <span key={j} className={`w${x.emphasis ? " em" : ""}`} style={{ color: active.mode === "karaoke" && x.spoken ? hi : x.emphasis ? hi : undefined }}>
                    {x.w.text}{" "}
                  </span>
                ))}
              </span>
            ))}
          </div>
        )}
        <div className="safe" aria-hidden />
      </div>
      <div className="transport">
        <button className="btn icon-btn" onClick={toggle} aria-label={playing ? "pause" : "play"}>{playing ? "❚❚" : "▶"}</button>
        <input type="range" min={es.start} max={es.end} step={0.05} value={clamp(time, es.start, es.end)}
          onChange={(e) => { const v = main.current; if (v) v.currentTime = Number(e.target.value); setTime(Number(e.target.value)); }} aria-label="seek" />
        <button className="btn icon-btn" onClick={() => setMuted((m) => !m)} aria-label="mute">{muted ? "🔇" : "🔊"}</button>
      </div>
      <span className="muted small" dir="ltr">{fmtTime(time - es.start)} / {fmtTime(es.end - es.start)}</span>
      <span className="muted small" style={{ textAlign: "center", maxWidth: 300 }}>{t("reframe_note")}</span>
    </div>
  );
}
