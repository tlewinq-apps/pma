// What the issue page shows about PostHog: whether the app has it, the errors linked to the issue with their 30-day
// numbers, and how many PostHog users the issue touches. Read with the signed-in member's client (RLS).
import type { SupabaseClient } from "@supabase/supabase-js";
import { posthogFor } from "./connection";
import { posthogReach, type Reach } from "./reach";

export type IssueLinkView = { id: string; external_id: string; title: string | null; url: string | null; users: number | null };
export type PostHogIssueView = { connected: false } | { connected: true; project: string | null; reach: Reach; links: IssueLinkView[] };

export async function posthogIssueView(db: SupabaseClient, projectId: string, issueId: string): Promise<PostHogIssueView> {
  const ph = await posthogFor(projectId).catch(() => null);
  if (!ph || ph.conn.status !== "ok" || !ph.config.project_id) return { connected: false };
  const [{ data: links }, reach] = await Promise.all([
    db.from("issue_links").select("id, external_id, title, url").eq("issue_id", issueId).eq("provider", "posthog").order("created_at"),
    posthogReach(db, issueId),
  ]);
  const ids = (links ?? []).map((l) => l.external_id as string);
  const { data: signals } = ids.length
    ? await db.from("issue_signals").select("key, users_30d").eq("project_id", projectId).eq("kind", "exception").in("key", ids)
    : { data: [] as { key: string; users_30d: number }[] };
  const users = new Map((signals ?? []).map((s) => [s.key as string, s.users_30d as number]));
  return {
    connected: true, project: ph.config.project_name, reach,
    links: (links ?? []).map((l) => ({ id: l.id as string, external_id: l.external_id as string, title: (l.title as string | null) ?? null, url: (l.url as string | null) ?? null, users: users.get(l.external_id as string) ?? null })),
  };
}
