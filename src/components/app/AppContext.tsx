"use client";
// Which app the page belongs to, for client components under /[org]/[app]. The layout fills it from requireApp with
// only these fields: never the project row, which holds the API key, the widget key and the Slack webhook.
import { createContext, useContext, useMemo } from "react";
import type { Role } from "@/lib/db/app";
import { appHref } from "@/lib/links";

export type AppValue = { orgSlug: string; appSlug: string; appId: string; base: string; role: Role };

const AppContext = createContext<AppValue | null>(null);

export function AppProvider({ value, children }: { value: AppValue; children: React.ReactNode }) {
  return <AppContext value={value}>{children}</AppContext>;
}

/** The current app, with `href("/issues/1")` for in-app links and `api("/settings")` for its API routes. */
export function useApp(): AppValue & { href(path: string): string; api(path: string): string } {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp needs an AppProvider: it only works on pages under /[org]/[app].");
  return useMemo(() => ({
    ...value,
    href: (path: string) => appHref(value.base, path),
    api: (path: string) => `/api/apps/${value.appId}${path}`,
  }), [value]);
}
