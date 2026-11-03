// An app's PostHog connection: one PostHog project per PMA app. The credentials (an OAuth token pair or a personal
// API key) live in Vault as JSON; the connection's config holds the region, the chosen project and, until one is
// chosen, the projects to pick from. It is connected once the project read and a HogQL "select 1" both work.
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";
import { audit, findConnection, last4, putSecret, readSecretJson, saveConnection, type Connection } from "@/lib/connections/store";
import { isRegion, limiterFor, PostHogApi, PostHogError, posthogHost, type PostHogCredentials, type PostHogProject, type Region } from "./client";
import { refreshPosthog } from "./oauth";

export type PostHogConfig = { region: Region; project_id: number | null; project_name: string | null; auth: "oauth" | "key"; projects?: PostHogProject[]; last_sync_at?: string };

export function parsePosthogConfig(v: unknown): PostHogConfig | null {
  const c = v as Partial<PostHogConfig> | null;
  if (!c || !isRegion(c.region) || (c.auth !== "oauth" && c.auth !== "key")) return null;
  return { region: c.region, project_id: typeof c.project_id === "number" ? c.project_id : null, project_name: c.project_name ?? null, auth: c.auth, projects: Array.isArray(c.projects) ? c.projects : undefined, last_sync_at: c.last_sync_at };
}

/** An API client for a saved connection, refreshing (and saving) OAuth tokens as needed. */
export function apiFor(conn: Pick<Connection, "id">, region: Region, creds: PostHogCredentials, db: SupabaseClient = serviceDb(), f?: typeof fetch): PostHogApi {
  return new PostHogApi(posthogHost(region), creds, {
    fetch: f, limiter: limiterFor(conn.id),
    refresh: (token) => refreshPosthog(region, token, f),
    onRefresh: (next) => putSecret(conn.id, next as unknown as Record<string, unknown>, db),
  });
}

/** The app's PostHog, ready to query: the connection, its config and an API client. Null when it isn't connected. */
export async function posthogFor(projectId: string, db: SupabaseClient = serviceDb()): Promise<{ conn: Connection; config: PostHogConfig; api: PostHogApi } | null> {
  const { data: p } = await db.from("projects").select("org_id").eq("id", projectId).maybeSingle();
  if (!p) return null;
  const conn = await findConnection("posthog", { orgId: p.org_id as string, projectId }, db);
  const config = parsePosthogConfig(conn?.config);
  if (!conn || !config || conn.status === "disconnected" || conn.status === "revoked") return null;
  const creds = await readSecretJson<PostHogCredentials & Record<string, unknown>>(conn.id, db);
  if (!creds) return null;
  return { conn, config, api: apiFor(conn, config.region, creds, db) };
}

export type Scope = { orgId: string; projectId: string; userId: string };

/** The project read and a one-row HogQL query: the credentials can see the project and run queries in it. */
export async function verifyPosthogProject(api: PostHogApi, projectId: number): Promise<PostHogProject> {
  const p = await api.project(projectId);
  await api.query(projectId, "select 1");
  return p;
}

export type SaveResult = { ok: true; connected: true; project: string } | { ok: true; connected: false; projects: PostHogProject[] } | { ok: false; error: string };

const errorText = (e: unknown) =>
  e instanceof PostHogError && e.denied ? "PostHog didn't accept that. Check the key has project and query read access, or sign in with PostHog again."
    : e instanceof PostHogError ? `PostHog answered ${e.status}. Try again in a moment.` : "Couldn't reach PostHog. Try again in a moment.";

/**
 * Saves new credentials (from OAuth or a pasted key). With exactly one project in reach (or the one picked on PostHog's
 * consent screen) it is chosen and checked at once; otherwise the projects are kept for the admin to pick.
 */
export async function savePosthogCredentials(s: Scope, region: Region, creds: PostHogCredentials, opts: { scopedProjects?: number[]; f?: typeof fetch; db?: SupabaseClient } = {}): Promise<SaveResult> {
  const db = opts.db ?? serviceDb();
  const auth = creds.kind;
  const conn = await saveConnection("posthog", { orgId: s.orgId, projectId: s.projectId }, {
    status: "pending", display: { region, auth, ...(creds.kind === "key" ? { last4: last4(creds.key) } : {}) }, config: { region, auth, project_id: null, project_name: null }, userId: s.userId,
  }, db);
  await putSecret(conn.id, creds as unknown as Record<string, unknown>, db);
  const api = apiFor(conn, region, creds, db, opts.f);
  let projects: PostHogProject[];
  try {
    projects = await api.projects();
  } catch (e) {
    // A project-scoped OAuth token may not list projects; the one picked on PostHog's screen is enough.
    if (!opts.scopedProjects?.length) return { ok: false, error: errorText(e) };
    projects = opts.scopedProjects.map((id) => ({ id, name: `Project ${id}` }));
  }
  const scoped = opts.scopedProjects?.length ? projects.filter((p) => opts.scopedProjects!.includes(p.id)) : projects;
  const choices = scoped.length ? scoped : projects;
  if (choices.length === 1) {
    const r = await choosePosthogProject(s, choices[0].id, { db, f: opts.f });
    return r.ok ? { ok: true, connected: true, project: r.project } : r;
  }
  if (!choices.length) return { ok: false, error: "Those credentials can't see any PostHog project." };
  await saveConnection("posthog", { orgId: s.orgId, projectId: s.projectId }, { status: "pending", config: { region, auth, project_id: null, project_name: null, projects: choices.slice(0, 100) } }, db);
  return { ok: true, connected: false, projects: choices.slice(0, 100) };
}

/** Picks the PostHog project for this app and checks it. */
export async function choosePosthogProject(s: Scope, posthogProjectId: number, opts: { db?: SupabaseClient; f?: typeof fetch } = {}): Promise<{ ok: true; project: string } | { ok: false; error: string }> {
  const db = opts.db ?? serviceDb();
  const conn = await findConnection("posthog", { orgId: s.orgId, projectId: s.projectId }, db);
  const config = parsePosthogConfig(conn?.config);
  const creds = conn ? await readSecretJson<PostHogCredentials & Record<string, unknown>>(conn.id, db) : null;
  if (!conn || !config || !creds) return { ok: false, error: "Connect PostHog first." };
  if (config.projects && !config.projects.some((p) => p.id === posthogProjectId)) return { ok: false, error: "Pick one of the projects listed." };
  try {
    const p = await verifyPosthogProject(apiFor(conn, config.region, creds, db, opts.f), posthogProjectId);
    await saveConnection("posthog", { orgId: s.orgId, projectId: s.projectId }, {
      status: "ok", verified: true, externalId: String(p.id),
      display: { region: config.region, auth: config.auth, project: p.name, ...(creds.kind === "key" ? { last4: last4(creds.key) } : {}) },
      config: { region: config.region, auth: config.auth, project_id: p.id, project_name: p.name },
    }, db);
    await audit({ orgId: s.orgId, projectId: s.projectId, actorId: s.userId, action: "connection.connected", target: "posthog", detail: { project: p.name, region: config.region, auth: config.auth } }, db);
    return { ok: true, project: p.name };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}
