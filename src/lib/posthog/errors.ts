// PostHog errors next to a PMA issue: the app's recent errors, ranked so the likely matches come first. PMA
// suggests; a person confirms with Link. Matching is by the words the error and the issue share (no model call), with
// the most people affected breaking ties. Pure apart from recentErrors, which runs one HogQL query.
import type { PostHogApi } from "./client";
import { ERROR_ID, RECENT_ERRORS_QUERY } from "./sync";

export type PostHogErrorSummary = { id: string; label: string; users: number; events: number; lastSeen: string | null };

/** "TypeError: x is undefined" from the arrays PostHog keeps ($exception_types, $exception_values), however they come. */
export function errorLabel(types: unknown, values: unknown): string {
  const first = (v: unknown): string | null => {
    if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : null;
    if (typeof v === "string") {
      try { return first(JSON.parse(v)); } catch { return v || null; }
    }
    return null;
  };
  const t = first(types), m = first(values);
  return (t && m ? `${t}: ${m}` : t ?? m ?? "Unnamed error").replace(/\s+/g, " ").slice(0, 200);
}

export async function recentErrors(api: PostHogApi, posthogProjectId: number): Promise<PostHogErrorSummary[]> {
  const { results } = await api.query(posthogProjectId, RECENT_ERRORS_QUERY);
  return results.filter((r) => typeof r[0] === "string" && ERROR_ID.test(r[0] as string)).map((r) => ({
    id: r[0] as string, label: errorLabel(r[1], r[2]), users: Number(r[3]) || 0, events: Number(r[4]) || 0, lastSeen: typeof r[5] === "string" ? r[5] : null,
  }));
}

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "is", "it", "for", "with", "when", "i", "my", "be", "can", "not", "at", "this", "that", "error", "undefined", "null", "cannot", "read", "properties"]);
// "PaymentForm" and "TypeError" are two words each, like the issue's own text would say them.
const words = (s: string) => new Set(s.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));

/** Errors ordered for this issue: shared words first (with the count as `score`), then the rest by people affected. Any tool's errors (PostHog, Sentry). */
export function rankErrors<T extends { label: string; users: number }>(issue: { title: string; problem: string | null; quotes?: string[] }, errors: T[]): (T & { score: number })[] {
  const mine = words([issue.title, issue.problem ?? "", ...(issue.quotes ?? [])].join(" "));
  return errors
    .map((e) => ({ ...e, score: [...words(e.label)].filter((w) => mine.has(w)).length }))
    .sort((a, b) => b.score - a.score || b.users - a.users);
}
