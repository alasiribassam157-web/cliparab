"use client";

import type { ReactNode } from "react";
import { Shell } from "@/components/ui";
import { useRequireUser } from "@/lib/backend";
import { useI18n } from "@/lib/i18n";
import { UserContext } from "@/lib/user";

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, refresh } = useRequireUser();
  const { t } = useI18n();
  return (
    <UserContext.Provider value={{ user, refresh }}>
      <Shell authed minutes={user?.minutes_remaining}>
        {user ? children : <p className="muted">{t("loading")}</p>}
      </Shell>
    </UserContext.Provider>
  );
}
