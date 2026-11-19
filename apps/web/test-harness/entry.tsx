import { createRoot } from "react-dom/client";
import type { ComponentType, ReactNode } from "react";
import "../app/globals.css";
import { I18nProvider } from "@/lib/i18n";
import { BackendProvider } from "@/lib/backend";
import { usePathname, setParams } from "./stubs/next-navigation";
import Landing from "@/app/page";
import AppLayout from "@/app/app/layout";
import Dashboard from "@/app/app/page";
import NewProject from "@/app/app/new/page";
import ProjectPage from "@/app/app/p/[id]/page";
import Editor from "@/app/app/c/[id]/page";
import Settings from "@/app/app/settings/page";
import Review from "@/app/review/[token]/page";

type Route = { re: RegExp; keys: string[]; page: ComponentType; layout?: ComponentType<{ children: ReactNode }> };
const routes: Route[] = [
  { re: /^\/$/, keys: [], page: Landing },
  { re: /^\/app$/, keys: [], page: Dashboard, layout: AppLayout },
  { re: /^\/app\/new$/, keys: [], page: NewProject, layout: AppLayout },
  { re: /^\/app\/settings$/, keys: [], page: Settings, layout: AppLayout },
  { re: /^\/app\/p\/([^/]+)$/, keys: ["id"], page: ProjectPage, layout: AppLayout },
  { re: /^\/app\/c\/([^/]+)$/, keys: ["id"], page: Editor, layout: AppLayout },
  { re: /^\/review\/([^/]+)$/, keys: ["token"], page: Review },
];

function Router() {
  const path = usePathname();
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      setParams(Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]])));
      const Page = r.page;
      const Layout = r.layout;
      // key forces a fresh mount per URL like Next's page segments do
      return Layout ? <Layout key={path}><Page /></Layout> : <Page key={path} />;
    }
  }
  return <p>404</p>;
}

createRoot(document.getElementById("root")!).render(
  <I18nProvider><BackendProvider><Router /></BackendProvider></I18nProvider>,
);
