"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { statusChip } from "@/components/ui";
import { useBackend } from "@/lib/backend";
import { fmtDate, fmtDuration } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Project } from "@/lib/types";

export default function Dashboard() {
  const { t, locale } = useI18n();
  const backend = useBackend();
  const [projects, setProjects] = useState<Project[] | null>(null);

  useEffect(() => {
    let alive = true;
    backend.listProjects().then((p) => alive && setProjects(p)).catch(() => alive && setProjects([]));
    return () => { alive = false; };
  }, [backend]);

  return (
    <div className="stack">
      <div className="row spread">
        <h1 style={{ margin: 0 }}>{t("projects_title")}</h1>
        <Link className="btn primary" href="/app/new">{t("nav_new")}</Link>
      </div>
      {projects === null ? <p className="muted">{t("loading")}</p> : projects.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <p className="muted">{t("no_projects")}</p>
          <Link className="btn primary" href="/app/new">{t("nav_new")}</Link>
        </div>
      ) : (
        <div className="projects">
          {projects.map((p) => (
            <Link key={p.id} href={`/app/p/${p.id}`} className="card project-card">
              <div className="row spread"><b>{p.name}</b>{statusChip(p.status, t)}</div>
              <span className="muted small">{p.source ? `${p.source.filename} · ${fmtDuration(p.source.duration)}` : "—"}</span>
              <span className="muted small">{fmtDate(p.created_at, locale)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
