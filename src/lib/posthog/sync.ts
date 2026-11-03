// posthog_sync: what an app's PostHog project says about its issues, over the last 30 days, from three HogQL queries:
// distinct people per linked error ($exception by $exception_issue_id), and rage clicks and page views by $pathname.
// Results go to issue_signals (refreshed in place; pathnames that went quiet are dropped). Runs daily from the cron
// and once after a project is connected. Every query goes through the connection's rate limiter.
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";
import { audit, markConnection, saveConnection } from "@/lib/connections/store";
import { PostHogError, type PostHogApi } from "./client";
import { posthogFor, type PostHogConfig } from "./connection";

/** PostHog error ids are uuids; anything else is refused before it can reach a query. */
export const ERROR_ID = /^[A-Za-z0-9_-]{1,100}$/;

const WINDOW = "timestamp > now() - INTERVAL 30 DAY";

export const PATH_QUERY = (event: "$pageview" | "$rageclick") =>
  `SELECT properties.$pathname AS path, count(DISTINCT person_id) AS users, count() AS events, max(timestamp) AS last_seen FROM events WHERE event = '${event}' AND ${WINDOW} AND properties.$pathname IS NOT NULL GROUP BY path ORDER BY users DESC LIMIT 200`;

export function exceptionQuery(ids: string[]): string | null {
  const safe = [...new Set(ids)].filter((id) => ERROR_ID.test(id));
  if (!safe.length) return null;
  return `SELECT properties.$exception_issue_id AS id, count(DISTINCT person_id) AS users, count() AS events, max(timestamp) AS last_seen FROM events WHERE event = '$exception' AND ${WINDOW} AND properties.$exception_issue_id IN (${safe.map((id) => `'${id}'`).join(", ")}) GROUP BY id`;
}

export const RECENT_ERRORS_QUERY =
  `SELECT properties.$exception_issue_id AS id, any(properties.$exception_types) AS types, any(properties.$exception_values) AS vals, count(DISTINCT person_id) AS users, count() AS events, max(timestamp) AS last_seen FROM events WHERE event = '$exception' AND ${WINDOW} AND properties.$exception_issue_id IS NOT NULL GROUP BY id ORDER BY users DESC LIMIT 50`;

type Row = { key: string; users: number; events: number; last: string | null };
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const rowsOf = (results: unknown[][]): Row[] =>
  results.filter((r) => typeof r[0] === "string" && r[0]).map((r) => ({ key: String(r[0]).slice(0, 500), users: num(r[1]), events: num(r[2]), last: typeof r[3] === "string" ? r[3] : null }));

export type SyncResult = { ok: true; pageviews: number; rageclicks: number; errors: number } | { ok: false; error: string };

/** Runs the three queries for one app and stores what they found. */
export async function syncSignals(projectId: string, api: PostHogApi, config: PostHogConfig, db: SupabaseClient = serviceDb()): Promise<{ pageviews: number; rageclicks: number; errors: number }> {
  const ph = config.project_id!;
  const started = new Date().toISOString();
  const { data: links } = await db.from("issue_links").select("issue_id, external_id").eq("project_id", projectId).eq("provider", "posthog");
  const linkOf = new Map<string, string>();
  for (const l of links ?? []) if (!linkOf.has(l.external_id as string)) linkOf.set(l.external_id as string, l.issue_id as string);
  const exQ = exceptionQuery([...linkOf.keys()]);
  const [pageviews, rageclicks, errors] = await Promise.all([
    api.query(ph, PATH_QUERY("$pageview")),
    api.query(ph, PATH_QUERY("$rageclick")),
    exQ ? api.query(ph, exQ) : Promise.resolve({ columns: [], results: [] }),
  ]);
  const signal = (kind: "pageview" | "rageclick" | "exception", r: Row) => ({
    project_id: projectId, provider: "posthog", kind, key: r.key, issue_id: kind === "exception" ? linkOf.get(r.key) ?? null : null,
    users_30d: r.users, events_30d: r.events, last_seen_at: r.last, refreshed_at: started,
  });
  const rows = [
    ...rowsOf(pageviews.results).map((r) => signal("pageview", r)),
    ...rowsOf(rageclicks.results).map((r) => signal("rageclick", r)),
    ...rowsOf(errors.results).map((r) => signal("exception", r)),
  ];
  if (rows.length) {
    const { error } = await db.from("issue_signals").upsert(rows, { onConflict: "project_id,provider,kind,key" });
    if (error) throw new Error(`issue_signals: ${error.message}`);
  }
  // Anything this run didn't see had no activity in 30 days.
  await db.from("issue_signals").delete().eq("project_id", projectId).eq("provider", "posthog").lt("refreshed_at", started);
  return { pageviews: rowsOf(pageviews.results).length, rageclicks: rowsOf(rageclicks.results).length, errors: rowsOf(errors.results).length };
}

/** posthog_sync for one app: never throws; a refused credential marks the connection Needs attention. */
export async function posthogSync(projectId: string, db: SupabaseClient = serviceDb()): Promise<SyncResult> {
  const ph = await posthogFor(projectId, db).catch(() => null);
  if (!ph || ph.conn.status !== "ok" || !ph.config.project_id) return { ok: false, error: "PostHog isn't connected" };
  try {
    const r = await syncSignals(projectId, ph.api, ph.config, db);
    const at = new Date().toISOString();
    await saveConnection("posthog", { orgId: ph.conn.org_id, projectId }, { status: "ok", config: { ...ph.config, last_sync_at: at }, display: { ...ph.conn.display, last_sync: at } }, db);
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof PostHogError && e.denied) {
      await markConnection(ph.conn.id, "broken", "PostHog stopped accepting PMA's access. Connect PostHog again.", db);
      await audit({ orgId: ph.conn.org_id, projectId, action: "connection.broken", target: "posthog", detail: { status: e.status } }, db);
    }
    console.error("[posthog] sync failed", projectId, (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }
}

/** The daily run: every app with PostHog connected, one after another (each shares its credential's rate limit). */
export async function posthogSyncAll(db: SupabaseClient = serviceDb()): Promise<Record<string, SyncResult>> {
  const { data } = await db.from("connections").select("project_id").eq("kind", "posthog").eq("status", "ok").not("project_id", "is", null);
  const out: Record<string, SyncResult> = {};
  for (const { project_id } of data ?? []) out[project_id as string] = await posthogSync(project_id as string, db);
  return out;
}
