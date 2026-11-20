"use client";

import { useParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Shell } from "@/components/ui";
import { errorText, useBackend } from "@/lib/backend";
import { fmtTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { ReviewPage } from "@/lib/types";

export default function Review() {
  const { token } = useParams<{ token: string }>();
  const { t, locale } = useI18n();
  const backend = useBackend();
  const [page, setPage] = useState<ReviewPage | null>(null);
  const [err, setErr] = useState("");
  const [author, setAuthor] = useState("");
  const [body, setBody] = useState("");

  const load = () => backend.review(token).then(setPage).catch((e) => setErr(errorText(e, locale)));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    await backend.addComment(token, author, body);
    setBody("");
    await load();
  };

  const videoSrc = page?.video_url ? (page.video_url.startsWith("http") || backend.mode !== "live" ? page.video_url : backend.reviewVideoUrl(token)) : null;
  return (
    <Shell>
      <div className="stack" style={{ maxWidth: 560, marginInline: "auto" }}>
        <h1>{t("review_title")}{page?.title ? `: ${page.title}` : ""}</h1>
        {err && <div className="err" role="alert">{err}</div>}
        {page && (videoSrc ? <video src={videoSrc} controls playsInline style={{ width: "100%", maxHeight: 520, borderRadius: 16, background: "#000" }} /> : <div className="card">{t("no_video_yet")}</div>)}
        {page && (
          <div className="card">
            <h3>{t("comments")}</h3>
            {page.comments.map((c) => (
              <div className="comment" key={c.id}><b>{c.author}</b>{c.at_seconds !== null && <span className="muted small" dir="ltr"> · {fmtTime(c.at_seconds)}</span>}<div>{c.body}</div></div>
            ))}
            {page.allow_comments && (
              <form className="stack" onSubmit={send} style={{ marginTop: 12 }}>
                <input className="input" required placeholder={t("your_name")} value={author} onChange={(e) => setAuthor(e.target.value)} />
                <textarea className="input" required rows={3} placeholder={t("comment")} value={body} onChange={(e) => setBody(e.target.value)} />
                <button className="btn primary">{t("send")}</button>
              </form>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}
