"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { PhonePreview } from "@/components/PhonePreview";
import { Progress, useToast } from "@/components/ui";
import { errorText, useBackend } from "@/lib/backend";
import { clamp, fmtBytes } from "@/lib/format";
import { isEmphasis } from "@/lib/captions";
import { useI18n } from "@/lib/i18n";
import { ApiException, type Clip, type EditState, type ExportItem, type Project, type Transcript, type WordT } from "@/lib/types";

type Tab = "trim" | "layout" | "captions" | "text" | "export";
const PRESETS: { k: string; ar: string; en: string; c: Partial<import("@/lib/types").CaptionStyleT> }[] = [
  { k: "hormozi", ar: "الأكثر انتشارًا", en: "Viral", c: { mode: "karaoke", color: "#FFFFFF", highlight: "#FFD21F", box: false, font_size: 84, position: "bottom" } },
  { k: "neon", ar: "نيون", en: "Neon", c: { mode: "karaoke", color: "#FFFFFF", highlight: "#22D3EE", box: false, font_size: 78, position: "bottom" } },
  { k: "lime", ar: "ليموني", en: "Lime", c: { mode: "karaoke", color: "#FFFFFF", highlight: "#A3E635", box: false, font_size: 82, position: "middle" } },
  { k: "pop", ar: "كلمة بكلمة", en: "Word pop", c: { mode: "pop", color: "#FFFFFF", highlight: "#F472B6", box: false, font_size: 96, position: "middle" } },
  { k: "clean", ar: "نظيف", en: "Clean", c: { mode: "plain", color: "#FFFFFF", highlight: "#FFD21F", box: true, font_size: 64, position: "bottom" } },
  { k: "cinema", ar: "سينمائي", en: "Cinema", c: { mode: "plain", color: "#F5E9C8", highlight: "#F5E9C8", box: false, font_size: 60, position: "bottom" } },
];
const COLORS = ["#FFD21F", "#22D3EE", "#34D399", "#F472B6", "#FFFFFF"];

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="group">
      {options.map(([v, label]) => <button key={v} aria-pressed={value === v} onClick={() => onChange(v)}>{label}</button>)}
    </div>
  );
}

export default function Editor() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const backend = useBackend();
  const [clip, setClip] = useState<Clip | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [es, setEs] = useState<EditState | null>(null);
  const [tab, setTab] = useState<Tab>("trim");
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "conflict">("idle");
  const [textMode, setTextMode] = useState<"emph" | "edit">("emph");
  const [exp, setExp] = useState<ExportItem | null>(null);
  const [expProgress, setExpProgress] = useState(0);
  const [reviewUrl, setReviewUrl] = useState("");
  const [err, setErr] = useState("");
  const [trProg, setTrProg] = useState<number | null>(null);
  const [toast, say] = useToast();
  const version = useRef(1);
  const pending = useRef<Partial<EditState>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const title = useRef("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const c = await backend.getClip(id);
        const cl = c.edit_state.cap_lang === "ar" || c.edit_state.cap_lang === "en" ? c.edit_state.cap_lang : undefined;
        const [p, tr] = await Promise.all([backend.getProject(c.project_id), backend.transcript(c.project_id, cl)]);
        if (!alive) return;
        version.current = c.version;
        title.current = c.title;
        setClip(c); setProject(p); setTranscript(tr); setEs(c.edit_state);
      } catch (e) { if (alive) setErr(errorText(e, locale)); }
    })();
    return () => { alive = false; };
  }, [backend, id, locale]);

  const flush = async () => {
    const patch = pending.current;
    if (!Object.keys(patch).length) return;
    pending.current = {};
    setSave("saving");
    try {
      const c = await backend.patchClip(id, version.current, { edit_state: patch });
      version.current = c.version;
      setSave("saved");
    } catch (e) {
      if (e instanceof ApiException && e.status === 409) setSave("conflict");
      else { setSave("idle"); setErr(errorText(e, locale)); }
    }
  };

  const update = (patch: Partial<EditState>) => {
    setEs((cur) => {
      if (!cur) return cur;
      const merged = { ...cur, ...patch, caption: { ...cur.caption, ...(patch.caption ?? {}) } } as EditState;
      return merged;
    });
    pending.current = { ...pending.current, ...patch, ...(patch.caption ? { caption: { ...(pending.current.caption ?? {}), ...patch.caption } } : {}) };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 700);
  };

  const duration = project?.source?.duration ?? 0;
  const baseWords: WordT[] = useMemo(() => {
    if (!es || !transcript) return [];
    if (es.words) return es.words;
    return transcript.segments.flatMap((s) => s.words).filter((w) => w.end > es.start && w.start < es.end);
  }, [es, transcript]);

  if (!clip || !es || !project) return <p className="muted">{err || t("loading")}</p>;

  const setStart = (v: number) => update({ start: clamp(Math.round(v * 10) / 10, 0, Math.max(0, es.end - 1)) });
  const setEnd = (v: number) => update({ end: clamp(Math.round(v * 10) / 10, es.start + 1, duration || v) });
  const cap = es.caption;

  const toggleEmphasis = (w: WordT) => {
    const list = cap.emphasis ?? [];
    update({ caption: { emphasis: isEmphasis(w.text, list) ? list.filter((e) => !isEmphasis(w.text, [e])) : [...list, w.text] } });
  };
  const editWord = (i: number, text: string) => {
    const copy = baseWords.map((w) => ({ ...w }));
    copy[i].text = text;
    update({ words: copy });
  };

  const startExport = async () => {
    await flush();
    setErr("");
    try {
      const r = await backend.exportClip(id, es.resolution);
      setExp(r.export);
      const stop = backend.watchJob(r.job.id, async (j) => {
        setExpProgress(j.progress);
        if (j.status === "done") { setExp(await backend.getExport(r.export.id)); stop(); }
        if (j.status === "error") { setErr(locale === "ar" ? j.error?.message_ar ?? "" : j.error?.message_en ?? ""); setExp(null); stop(); }
      });
    } catch (e) { setErr(errorText(e, locale)); }
  };

  const makeReview = async () => {
    const r = await backend.createReviewLink(id);
    setReviewUrl(window.location.origin + r.path);
  };

  const capLang = (es.cap_lang === "ar" || es.cap_lang === "en" ? es.cap_lang : transcript?.language === "en" ? "en" : "ar") as "ar" | "en";
  const canSwitch = backend.mode === "local" && !!transcript?.segments.length;
  const switchLang = async (l: "ar" | "en") => {
    if (l === capLang || trProg !== null) return;
    setTrProg(0); setErr("");
    try {
      const tr = await backend.transcript(project.id, l, (f) => setTrProg(f));
      setTranscript(tr);
      update({ cap_lang: l, words: null, caption: { emphasis: [] } });
    } catch { setErr(t("tr_fail")); }
    finally { setTrProg(null); }
  };

  const saveLabel = save === "saving" ? t("saving") : save === "saved" ? t("saved") : save === "conflict" ? t("conflict") : "";
  return (
    <div className="editor">
      <div className="preview-col">
        <PhonePreview src={backend.mediaUrl(project.id)} es={es} words={baseWords} aspect={(project.source?.width ?? 16) / (project.source?.height ?? 9)} />
        {canSwitch && (
          <div className="cap-switch">
            <span className="small muted">{t("cap_lang")}</span>
            <div className="seg" role="group" aria-label={t("cap_lang")} data-testid="cap-switch">
              <button type="button" aria-pressed={capLang === "ar"} onClick={() => switchLang("ar")} disabled={trProg !== null}>العربية</button>
              <button type="button" aria-pressed={capLang === "en"} onClick={() => switchLang("en")} disabled={trProg !== null}>English</button>
            </div>
            {trProg !== null && <div className="stack" style={{ gap: 4, width: "100%" }}><span className="small muted">{t("translating")} {Math.round(trProg * 100)}%</span><div className="progress"><i style={{ width: `${Math.max(4, trProg * 100)}%` }} /></div></div>}
          </div>
        )}
      </div>
      <div className="card">
        <div className="row spread" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{clip.title}</h2>
          <span role="status">{saveLabel && <span className={`chip ${save === "conflict" ? "bad" : save === "saved" ? "ok" : ""}`}>{saveLabel}</span>}</span>
        </div>
        {err && <div className="err" role="alert">{err}</div>}
        <div className="tabs" role="tablist">
          {(["trim", "layout", "captions", "text", "export"] as Tab[]).map((k) => (
            <button key={k} className="tab" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{t("ed_" + k)}</button>
          ))}
        </div>

        {tab === "trim" && (
          <div className="stack">
            {([["start", es.start, setStart], ["end", es.end, setEnd]] as const).map(([k, v, set]) => (
              <div key={k} className="stack" style={{ gap: 6 }}>
                <div className="numrow"><b style={{ minWidth: 70 }}>{t(k)}</b>
                  <button className="btn sm" onClick={() => set(v - 0.5)}>−0.5</button>
                  <input className="input" type="number" step={0.1} value={v} onChange={(e) => set(Number(e.target.value))} dir="ltr" aria-label={t(k)} />
                  <button className="btn sm" onClick={() => set(v + 0.5)}>+0.5</button></div>
                <input type="range" min={0} max={duration || 1} step={0.1} value={v} onChange={(e) => set(Number(e.target.value))} aria-label={t(k)} />
              </div>
            ))}
            <span className="muted small">{t("dur")}: {(es.end - es.start).toFixed(1)} {t("sec")}</span>
          </div>
        )}

        {tab === "layout" && (
          <div className="stack">
            <Seg value={es.layout} onChange={(v) => update({ layout: v })} options={[["fill", t("layout_fill")], ["fit", t("layout_fit")], ["split", t("layout_split")]]} />
            {es.layout === "fill" && (
              <>
                <b>{t("reframe")}</b>
                <Seg value={es.reframe_mode} onChange={(v) => update({ reframe_mode: v })} options={[["auto", t("reframe_auto")], ["center", t("reframe_center")], ["manual", t("reframe_manual")]]} />
                {es.reframe_mode === "manual" && (
                  <label className="field">{t("center_pos")}<input type="range" min={0} max={1} step={0.01} value={es.manual_center} onChange={(e) => update({ manual_center: Number(e.target.value) })} /></label>
                )}
              </>
            )}
            {es.layout === "split" && (
              <>
                {[0, 1].map((i) => {
                  const cs = (es.split_centers as unknown as [number, number] | null) ?? [0.25, 0.75];
                  return <label key={i} className="field">{t("center_pos")} {i + 1}<input type="range" min={0} max={1} step={0.01} value={cs[i]} onChange={(e) => { const n: [number, number] = [cs[0], cs[1]]; n[i] = Number(e.target.value); update({ split_centers: n as never }); }} /></label>;
                })}
              </>
            )}
          </div>
        )}

        {tab === "captions" && (
          <div className="stack">
            <label className="row"><input type="checkbox" checked={es.captions} onChange={(e) => update({ captions: e.target.checked })} />{t("cap_on")}</label>
            <b>{t("cap_presets")}</b>
            <div className="presets" role="group">
              {PRESETS.map((p) => <button key={p.k} type="button" className="chip preset" onClick={() => update({ caption: p.c })}>{locale === "ar" ? p.ar : p.en}</button>)}
            </div>
            <label className="row"><input type="checkbox" checked={es.hook !== false} onChange={(e) => update({ hook: e.target.checked })} />{t("hook_on")}</label>
            {es.hook !== false && <input className="input" value={String(es.hook_text ?? "")} maxLength={90} placeholder={t("hook_ph")} onChange={(e) => update({ hook_text: e.target.value })} aria-label={t("hook_on")} />}
            <b>{t("cap_mode")}</b>
            <Seg value={cap.mode ?? "karaoke"} onChange={(v) => update({ caption: { mode: v } })} options={[["karaoke", t("cap_karaoke")], ["plain", t("cap_plain")], ["pop", t("cap_pop")]]} />
            <b>{t("cap_pos")}</b>
            <Seg value={cap.position ?? "bottom"} onChange={(v) => update({ caption: { position: v } })} options={[["bottom", t("pos_bottom")], ["middle", t("pos_middle")], ["top", t("pos_top")]]} />
            <label className="field">{t("cap_size")}: {cap.font_size ?? 74}<input type="range" min={50} max={110} step={2} value={cap.font_size ?? 74} onChange={(e) => update({ caption: { font_size: Number(e.target.value) } })} /></label>
            <b>{t("cap_color")}</b>
            <div className="swatches">{COLORS.map((c) => <button key={c} className="swatch" style={{ background: c }} aria-pressed={(cap.highlight ?? "#FFD21F") === c} aria-label={c} onClick={() => update({ caption: { highlight: c } })} />)}</div>
            <label className="row"><input type="checkbox" checked={!!cap.box} onChange={(e) => update({ caption: { box: e.target.checked } })} />Box</label>
          </div>
        )}

        {tab === "text" && (
          <div className="stack">
            <Seg value={textMode} onChange={setTextMode} options={[["emph", t("ed_emph")], ["edit", t("transcript")]]} />
            <span className="muted small">{textMode === "emph" ? t("emphasis_hint") : t("edit_words_hint")}</span>
            <div className="words" dir={/[\u0600-\u06FF]/.test(baseWords.map((w) => w.text).join("")) ? "rtl" : "ltr"}>
              {baseWords.map((w, i) => textMode === "emph"
                ? <button key={i} className="word" aria-pressed={isEmphasis(w.text, cap.emphasis ?? [])} onClick={() => toggleEmphasis(w)}>{w.text}</button>
                : <input key={i} value={w.text} size={Math.max(3, w.text.length)} onChange={(e) => editWord(i, e.target.value)} aria-label={`word ${i + 1}`} />)}
            </div>
          </div>
        )}

        {tab === "export" && (
          <div className="stack">
            <label className="field">{t("resolution")}
              <select className="input" value={es.resolution} onChange={(e) => update({ resolution: e.target.value as "720p" | "1080p" })}>
                <option value="1080p">1080 × 1920</option><option value="720p">720 × 1280</option>
              </select></label>
            <div className="row"><span className="chip ok">{t("no_watermark")}</span></div>
            {backend.mode === "demo" && <span className="muted small">{t("demo_export_note")}</span>}
            {backend.mode === "local" && <span className="muted small">{t("local_export_note")}</span>}
            <button className="btn primary" onClick={startExport} disabled={!!exp && exp.status !== "done"}>{exp && exp.status !== "done" ? t("exporting") : t("export_btn")}</button>
            {exp && exp.status !== "done" && <Progress value={expProgress} />}
            {exp?.status === "done" && exp.download_url && (
              <div className="stack">
                <video src={backend.exportUrl(exp)} controls playsInline style={{ width: 220, borderRadius: 16, background: "#000" }} />
                <div className="row">
                  <a className="btn primary" href={backend.exportUrl(exp, true)} download={`${(clip.title || "clip").replace(/[\\/:*?"<>|…]/g, "").slice(0, 60)}.${(exp as ExportItem & { mime?: string }).mime === "video/webm" ? "webm" : "mp4"}`}>{t("download")} · {fmtBytes(exp.size_bytes)}</a>
                  <button className="btn" onClick={makeReview}>{t("review_link")}</button>
                </div>
              </div>
            )}
            {reviewUrl && (
              <div className="row">
                <input className="input" readOnly value={reviewUrl} dir="ltr" onFocus={(e) => e.target.select()} style={{ flex: 1 }} />
                <button className="btn sm" onClick={() => { void navigator.clipboard?.writeText(reviewUrl); say(t("copied")); }}>{t("copy")}</button>
              </div>
            )}
          </div>
        )}
      </div>
      {toast}
    </div>
  );
}
