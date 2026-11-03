// How many people an issue touches in the app's own tools, for Why it matters and urgency: distinct people on the errors
// linked to it (PostHog's and Sentry's) plus distinct people rage-clicking on its screens' paths (the app's route_map,
// from PostHog), over 30 days. Each signal is counted once even when it is linked twice. Read with the caller's client,
// so RLS keeps it inside the company.
import type { SupabaseClient } from "@supabase/supabase-js";

export type Reach = { users: number; errors: number; rageclicks: number };
/** The tools whose errors can be linked to an issue. Their error ids never collide (PostHog's are uuids, Sentry's numbers). */
export const ERROR_PROVIDERS = ["posthog", "sentry"] as const;
/** An issue_signals row as reach reads it. */
export type ReachSignal = { kind: string; key: string; users_30d: number | string | null };

/** Paths in the route map that point at one of these frames. */
export function pathsForFrames(routeMap: Record<string, string> | null | undefined, frameIds: string[]): string[] {
  const set = new Set(frameIds);
  return Object.entries(routeMap ?? {}).filter(([, f]) => set.has(f)).map(([path]) => path);
}

/** Whether a PostHog $pathname falls under one of the route-map paths ("/checkout" covers "/checkout/pay"). */
export const pathMatches = (pathname: string, paths: string[]) =>
  paths.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));

/** Pure: the app's signals, the PostHog errors linked to the issue and its screens' paths, as one reach. */
export function reachFrom(signals: ReachSignal[], linkedErrors: string[], paths: string[]): Reach {
  const ids = new Set(linkedErrors);
  let errors = 0, rageclicks = 0;
  for (const s of signals) {
    if (s.kind === "exception" && ids.has(s.key)) errors += Number(s.users_30d) || 0;
    if (s.kind === "rageclick" && paths.length && pathMatches(s.key, paths)) rageclicks += Number(s.users_30d) || 0;
  }
  return { users: errors + rageclicks, errors, rageclicks };
}

export async function posthogReach(db: SupabaseClient, issueId: string): Promise<Reach> {
  const { data: issue } = await db.from("issues").select("project_id, projects(route_map), issue_screens(screens(frame_id))").eq("id", issueId).maybeSingle();
  if (!issue) return { users: 0, errors: 0, rageclicks: 0 };
  const { data: links } = await db.from("issue_links").select("external_id").eq("issue_id", issueId).in("provider", ERROR_PROVIDERS);
  const { data: signals } = await db.from("issue_signals").select("kind, key, users_30d").eq("project_id", issue.project_id).in("kind", ["exception", "rageclick"]);
  const frames = ((issue as unknown as { issue_screens?: { screens?: { frame_id?: string } | null }[] }).issue_screens ?? []).map((s) => s.screens?.frame_id).filter((f): f is string => !!f);
  const paths = pathsForFrames((issue as unknown as { projects?: { route_map?: Record<string, string> } | null }).projects?.route_map, frames);
  return reachFrom((signals ?? []) as ReachSignal[], (links ?? []).map((l) => l.external_id as string), paths);
}

/**
 * Each issue's users in the app's tools (Reach.users, as posthogReach counts them, PostHog's and Sentry's errors) for
 * urgency on the Desk, Why it matters and the feedback page, from the app's signals in one read (and its links and route
 * map only when it has any). An app without that data, or a read that fails, gives nobody: urgency then counts reports
 * alone.
 */
export async function posthogUsersByIssue(db: SupabaseClient, projectId: string, issues: { id: string; frames: string[] }[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!issues.length) return out;
  try {
    const { data: signals, error } = await db.from("issue_signals").select("kind, key, users_30d").eq("project_id", projectId).in("kind", ["exception", "rageclick"]);
    if (error || !signals?.length) return out;
    const [{ data: links }, { data: project }] = await Promise.all([
      db.from("issue_links").select("issue_id, external_id").eq("project_id", projectId).in("provider", ERROR_PROVIDERS).in("issue_id", issues.map((i) => i.id)),
      db.from("projects").select("route_map").eq("id", projectId).maybeSingle(),
    ]);
    const linked = new Map<string, string[]>();
    for (const l of (links ?? []) as { issue_id: string; external_id: string }[]) linked.set(l.issue_id, [...(linked.get(l.issue_id) ?? []), l.external_id]);
    const routeMap = (project as { route_map?: Record<string, string> | null } | null)?.route_map;
    for (const i of issues) {
      const users = reachFrom(signals as ReachSignal[], linked.get(i.id) ?? [], pathsForFrames(routeMap, i.frames)).users;
      if (users) out.set(i.id, users);
    }
  } catch (e) {
    console.error("[posthog] reach read failed", (e as Error).message);
  }
  return out;
}
