// sentry_sync: what an app's Sentry project says, over the last 30 days. Its unresolved errors go to issue_signals
// (people and events per error, refreshed in place; errors that went quiet are dropped), so an issue an error is linked
// to counts those people in its urgency. The feedback people sent through Sentry's User Feedback is queued as 'sentry'
// sources, one per feedback (keyed sentry:<issue id>), for /api/cron/process to read like any other feedback.
// Runs once a day, every hour from /api/cron/process, once after a project is connected, and from Refresh now.
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";
import { enqueueSource } from "@/lib/ingest/enqueue";
import { audit, markConnection, saveConnection } from "@/lib/connections/store";
import { feedbackOf, SentryError, type SentryIssue } from "./client";
import { sentryFor, type SentryCtx } from "./connection";

export const ERRORS_QUERY = "is:unresolved issue.category:error";
export const FEEDBACK_QUERY = "issue.category:feedback";
/** How often /api/cron/process refreshes a connected project. */
export const SYNC_EVERY_MS = 60 * 60_000;

export type SentrySyncResult = { ok: true; errors: number; feedback: number; queued: string[] } | { ok: false; error: string };

/** The issue_signals rows for a project's errors: one per error, linked to the issue it was linked to, if any. */
export function signalRows(projectId: string, errors: SentryIssue[], linkOf: Map<string, string>, refreshedAt: string) {
  return errors.map((e) => ({
    project_id: projectId, provider: "sentry", kind: "exception", key: e.id, label: e.title, url: e.permalink, issue_id: linkOf.get(e.id) ?? null,
    users_30d: Math.round(e.userCount), events_30d: Math.round(e.count), last_seen_at: e.lastSeen, refreshed_at: refreshedAt,
  }));
}

/** A feedback as the source it becomes: what they wrote, who they are when they said, and where it came from. */
export function feedbackSource(issue: SentryIssue): Parameters<typeof enqueueSource>[1] | null {
  const f = feedbackOf(issue);
  if (!f) return null;
  return {
    kind: "sentry", raw_text: f.message, author: f.name ?? f.email ?? "Sentry user", channel: "Sentry user feedback", occurred_at: issue.firstSeen,
    metadata: { sentry: { issue_id: issue.id, short_id: issue.shortId, permalink: issue.permalink } }, hashKey: `sentry:${issue.id}`,
  };
}

/** Reads the project's errors and feedback and stores both. Throws what Sentry throws. */
export async function syncSentry(projectId: string, ctx: Pick<SentryCtx, "api" | "config">, db: SupabaseClient = serviceDb(), now = Date.now()): Promise<{ errors: number; feedback: number; queued: string[] }> {
  const started = new Date(now).toISOString();
  const org = { slug: ctx.config.org_slug, regionUrl: ctx.config.region_url };
  const [errors, feedback, { data: links }] = await Promise.all([
    ctx.api.issues(org, ctx.config.project_id, ERRORS_QUERY, { statsPeriod: "30d", limit: 100 }),
    ctx.api.issues(org, ctx.config.project_id, FEEDBACK_QUERY, { statsPeriod: "30d", limit: 50 }),
    db.from("issue_links").select("issue_id, external_id").eq("project_id", projectId).eq("provider", "sentry"),
  ]);
  const linkOf = new Map<string, string>();
  for (const l of links ?? []) if (!linkOf.has(l.external_id as string)) linkOf.set(l.external_id as string, l.issue_id as string);
  const rows = signalRows(projectId, errors, linkOf, started);
  if (rows.length) {
    const { error } = await db.from("issue_signals").upsert(rows, { onConflict: "project_id,provider,kind,key" });
    if (error) throw new Error(`issue_signals: ${error.message}`);
  }
  // Anything this run didn't see had no activity in 30 days.
  await db.from("issue_signals").delete().eq("project_id", projectId).eq("provider", "sentry").lt("refreshed_at", started);
  const queued: string[] = [];
  for (const issue of feedback) {
    const src = feedbackSource(issue);
    if (!src) continue;
    const r = await enqueueSource(projectId, src);
    if (!r.duplicate) queued.push(r.id);
  }
  return { errors: rows.length, feedback: feedback.length, queued };
}

/** sentry_sync for one app: never throws; a refused token marks the connection Needs attention. */
export async function sentrySync(projectId: string, db: SupabaseClient = serviceDb()): Promise<SentrySyncResult> {
  const ctx = await sentryFor(projectId, db).catch(() => null);
  if (!ctx) return { ok: false, error: "Sentry isn't connected" };
  try {
    const r = await syncSentry(projectId, ctx, db);
    const at = new Date().toISOString();
    await saveConnection("sentry", { orgId: ctx.conn.org_id, projectId }, { status: "ok", config: { ...ctx.config, last_sync_at: at }, display: { ...ctx.conn.display, last_sync: at } }, db);
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof SentryError && e.denied) {
      await markConnection(ctx.conn.id, "broken", "Sentry stopped accepting PMA's token. Connect Sentry again with a new token.", db);
      await audit({ orgId: ctx.conn.org_id, projectId, action: "connection.broken", target: "sentry", detail: { status: e.status } }, db);
    }
    console.error("[sentry] sync failed", projectId, (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }
}

/** Every connected app's Sentry, one after another; with `due`, only those not refreshed within SYNC_EVERY_MS. */
export async function sentrySyncAll(db: SupabaseClient = serviceDb(), opts: { due?: boolean; now?: number; max?: number } = {}): Promise<Record<string, SentrySyncResult>> {
  const { data } = await db.from("connections").select("project_id, config").eq("kind", "sentry").eq("status", "ok").not("project_id", "is", null);
  const now = opts.now ?? Date.now();
  const due = (data ?? []).filter((c) => {
    if (!opts.due) return true;
    const last = Date.parse(String((c.config as { last_sync_at?: unknown } | null)?.last_sync_at ?? ""));
    return !Number.isFinite(last) || now - last >= SYNC_EVERY_MS;
  }).slice(0, opts.max ?? Infinity);
  const out: Record<string, SentrySyncResult> = {};
  for (const { project_id } of due) out[project_id as string] = await sentrySync(project_id as string, db);
  return out;
}
