// What the issue page shows about Sentry: whether the app has it, the errors linked to the issue with their 30-day
// numbers, how many people they reached, and the app's other recent errors ranked for this issue (from the last
// sync's issue_signals, so the page never waits on Sentry). Read with the signed-in member's client (RLS).
import type { SupabaseClient } from "@supabase/supabase-js";
import { rankErrors } from "@/lib/posthog/errors";
import type { IssueLinkView } from "@/lib/posthog/issueView";
import type { Reach } from "@/lib/posthog/reach";
import { sentryFor } from "./connection";

export type SentrySuggestion = { id: string; label: string; users: number; score: number };
export type SentryIssueView = { connected: false } | { connected: true; project: string | null; reach: Reach; links: IssueLinkView[] };

type Signal = { key: string; label: string | null; users_30d: number | null };

export async function sentryIssueView(db: SupabaseClient, projectId: string, issueId: string): Promise<SentryIssueView> {
  const ctx = await sentryFor(projectId).catch(() => null);
  if (!ctx) return { connected: false };
  const { data: links } = await db.from("issue_links").select("id, external_id, title, url").eq("issue_id", issueId).eq("provider", "sentry").order("created_at");
  const ids = (links ?? []).map((l) => l.external_id as string);
  const { data: signals } = ids.length
    ? await db.from("issue_signals").select("key, users_30d").eq("project_id", projectId).eq("provider", "sentry").eq("kind", "exception").in("key", ids)
    : { data: [] as { key: string; users_30d: number }[] };
  const users = new Map((signals ?? []).map((s) => [s.key as string, s.users_30d as number]));
  const errors = ids.reduce((n, id) => n + (users.get(id) ?? 0), 0);
  return {
    connected: true, project: ctx.config.project_name, reach: { users: errors, errors, rageclicks: 0 },
    links: (links ?? []).map((l) => ({ id: l.id as string, external_id: l.external_id as string, title: (l.title as string | null) ?? null, url: (l.url as string | null) ?? null, users: users.get(l.external_id as string) ?? null })),
  };
}

/** The app's synced errors not yet linked to this issue, likely matches first (up to 12). */
export async function sentrySuggestions(db: SupabaseClient, projectId: string, issueId: string, linked: Set<string>): Promise<SentrySuggestion[]> {
  const [{ data: signals }, { data: issue }] = await Promise.all([
    db.from("issue_signals").select("key, label, users_30d").eq("project_id", projectId).eq("provider", "sentry").eq("kind", "exception").order("users_30d", { ascending: false }).limit(100),
    db.from("issues").select("title, problem_statement, feedback_units(quote)").eq("id", issueId).maybeSingle(),
  ]);
  const errors = ((signals ?? []) as Signal[]).filter((s) => !linked.has(s.key)).map((s) => ({ id: s.key, label: s.label ?? `Sentry issue ${s.key}`, users: Number(s.users_30d) || 0 }));
  const quotes = ((issue as { feedback_units?: { quote: string }[] } | null)?.feedback_units ?? []).map((u) => u.quote).slice(0, 6);
  return rankErrors({ title: (issue?.title as string | undefined) ?? "", problem: (issue?.problem_statement as string | null | undefined) ?? null, quotes }, errors).slice(0, 12);
}
