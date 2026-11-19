"use client";

import type { ReactNode } from "react";
import { Shell } from "@/components/ui";
import { useCurrentUser } from "@/lib/backend";
import { useI18n } from "@/lib/i18n";
import { UserContext } from "@/lib/user";

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, error, refresh } = useCurrentUser();
  const { t } = useI18n();
  return (
    <UserContext.Provider value={{ user, refresh }}>
      <Shell authed>
        {user ? children : error ? (
          <div className="card stack" role="alert">
            <p style={{ margin: 0 }}>{t("server_down")}</p>
            <button className="btn" style={{ alignSelf: "start" }} onClick={refresh}>{t("retry")}</button>
          </div>
        ) : <p className="muted">{t("loading")}</p>}
      </Shell>
    </UserContext.Provider>
  );
}
