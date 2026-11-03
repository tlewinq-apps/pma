// An app's Sentry connection: one Sentry project per PMA app, reached with a person's auth token. The token lives in
// Vault; the connection's config holds which Sentry it was checked against (sentry.io or a self-hosted address), the
// chosen organization and project with the region their data lives in, and, until one is chosen, the projects to pick
// from. It is connected once the project's issues can be read.
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";
import { audit, findConnection, last4, putSecret, readSecretJson, saveConnection, type Connection } from "@/lib/connections/store";
import { SENTRY_URL, sentryApi, sentryErrorText, sentryTokenProblem, type SentryApi } from "./client";

/** A project the admin can pick: `key` is "org/project", the way it is sent back. */
export type SentryChoice = { key: string; label: string; org_slug: string; org_name: string; region_url: string; project_id: string; project_slug: string; project_name: string };
export type SentryConfig = {
  base_url: string; org_slug: string | null; org_name: string | null; region_url: string | null;
  project_id: string | null; project_slug: string | null; project_name: string | null;
  projects?: SentryChoice[]; last_sync_at?: string;
};
type SentrySecret = { token: string };

const s = (v: unknown) => (typeof v === "string" && v ? v : null);

export function parseSentryConfig(v: unknown): SentryConfig | null {
  const c = v as Partial<SentryConfig> | null;
  if (!c || typeof c.base_url !== "string" || !c.base_url.startsWith("https://")) return null;
  return {
    base_url: c.base_url, org_slug: s(c.org_slug), org_name: s(c.org_name), region_url: s(c.region_url),
    project_id: s(c.project_id), project_slug: s(c.project_slug), project_name: s(c.project_name),
    projects: Array.isArray(c.projects) ? c.projects : undefined, last_sync_at: s(c.last_sync_at) ?? undefined,
  };
}

export type SentryCtx = { conn: Connection; config: SentryConfig & { org_slug: string; region_url: string; project_id: string }; api: SentryApi };

/** The app's Sentry, ready to read: the connection, its config and an API client. Null when it isn't connected. */
export async function sentryFor(projectId: string, db: SupabaseClient = serviceDb(), f?: typeof fetch): Promise<SentryCtx | null> {
  const { data: p } = await db.from("projects").select("org_id").eq("id", projectId).maybeSingle();
  if (!p) return null;
  const conn = await findConnection("sentry", { orgId: p.org_id as string, projectId }, db);
  const config = parseSentryConfig(conn?.config);
  if (!conn || conn.status !== "ok" || !config?.org_slug || !config.region_url || !config.project_id) return null;
  const secret = await readSecretJson<SentrySecret & Record<string, unknown>>(conn.id, db);
  if (!secret?.token) return null;
  return { conn, config: config as SentryCtx["config"], api: sentryApi(secret.token, f) };
}

export type Scope = { orgId: string; projectId: string; userId: string };
export type SaveResult = { ok: true; connected: true; project: string } | { ok: true; connected: false; projects: { key: string; label: string }[] } | { ok: false; error: string };

/**
 * Saves a pasted token and lists the projects it reaches (across every organization, each in its own region). With
 * exactly one, it is chosen and checked at once; otherwise the projects are kept for the admin to pick.
 */
export async function saveSentryToken(sc: Scope, token: string, opts: { base?: string; f?: typeof fetch; db?: SupabaseClient } = {}): Promise<SaveResult> {
  const problem = sentryTokenProblem(token);
  if (problem) return { ok: false, error: problem };
  const db = opts.db ?? serviceDb();
  const base = opts.base ?? SENTRY_URL;
  const api = sentryApi(token, opts.f);
  let choices: SentryChoice[] = [];
  try {
    for (const org of (await api.organizations(base)).slice(0, 10)) {
      for (const p of await api.projects(org)) {
        choices.push({ key: `${org.slug}/${p.slug}`, label: `${org.name} / ${p.name}`, org_slug: org.slug, org_name: org.name, region_url: org.regionUrl, project_id: p.id, project_slug: p.slug, project_name: p.name });
      }
    }
  } catch (e) {
    return { ok: false, error: sentryErrorText(e) };
  }
  if (!choices.length) return { ok: false, error: "That token can't see any Sentry project." };
  choices = choices.slice(0, 100);
  const conn = await saveConnection("sentry", { orgId: sc.orgId, projectId: sc.projectId }, {
    status: "pending", display: { last4: last4(token) }, config: { base_url: base, projects: choices }, userId: sc.userId,
  }, db);
  await putSecret(conn.id, { token }, db);
  if (choices.length === 1) {
    const r = await chooseSentryProject(sc, choices[0].key, { db, f: opts.f });
    return r.ok ? { ok: true, connected: true, project: r.project } : r;
  }
  return { ok: true, connected: false, projects: choices.map(({ key, label }) => ({ key, label })) };
}

/** Picks the Sentry project for this app and checks its issues can be read. */
export async function chooseSentryProject(sc: Scope, key: string, opts: { db?: SupabaseClient; f?: typeof fetch } = {}): Promise<{ ok: true; project: string } | { ok: false; error: string }> {
  const db = opts.db ?? serviceDb();
  const conn = await findConnection("sentry", { orgId: sc.orgId, projectId: sc.projectId }, db);
  const config = parseSentryConfig(conn?.config);
  const secret = conn ? await readSecretJson<SentrySecret & Record<string, unknown>>(conn.id, db) : null;
  if (!conn || !config || !secret?.token) return { ok: false, error: "Connect Sentry first." };
  const choice = config.projects?.find((p) => p.key === key);
  if (!choice) return { ok: false, error: "Pick one of the projects listed." };
  try {
    await sentryApi(secret.token, opts.f).issues({ slug: choice.org_slug, regionUrl: choice.region_url }, choice.project_id, "is:unresolved", { statsPeriod: "24h", limit: 1 });
  } catch (e) {
    return { ok: false, error: sentryErrorText(e) };
  }
  await saveConnection("sentry", { orgId: sc.orgId, projectId: sc.projectId }, {
    status: "ok", verified: true, externalId: choice.project_id,
    display: { last4: s(conn.display.last4), org: choice.org_name, project: choice.project_name },
    config: { base_url: config.base_url, org_slug: choice.org_slug, org_name: choice.org_name, region_url: choice.region_url, project_id: choice.project_id, project_slug: choice.project_slug, project_name: choice.project_name },
  }, db);
  await audit({ orgId: sc.orgId, projectId: sc.projectId, actorId: sc.userId, action: "connection.connected", target: "sentry", detail: { org: choice.org_slug, project: choice.project_slug } }, db);
  return { ok: true, project: choice.label };
}
