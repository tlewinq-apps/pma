/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase jsonb payloads are untyped */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UnitOutcome } from "./summary";

/** Units, issue titles and "started a new issue" flags for a page of sources: three queries, whatever the page size. */
export async function loadOutcomes(db: SupabaseClient, sourceIds: string[]) {
  const units = new Map<string, UnitOutcome[]>();
  const titles = new Map<string, string>();
  const created = new Map<string, Set<string>>();
  if (!sourceIds.length) return { units, titles, created };

  const { data: rows } = await db.from("feedback_units").select("source_id,issue_id,type").in("source_id", sourceIds);
  for (const u of rows ?? []) units.set(u.source_id, [...(units.get(u.source_id) ?? []), { issue_id: u.issue_id, type: u.type }]);
  const issueIds = [...new Set((rows ?? []).map((u) => u.issue_id).filter(Boolean))] as string[];
  if (!issueIds.length) return { units, titles, created };

  const [{ data: issues }, { data: added }] = await Promise.all([
    db.from("issues").select("id,title").in("id", issueIds),
    db.from("activity").select("issue_id,payload").eq("kind", "feedback_added").in("issue_id", issueIds),
  ]);
  for (const i of issues ?? []) titles.set(i.id, i.title);
  for (const a of (added ?? []) as any[]) {
    if (!a.payload?.created || !a.payload?.source_id) continue;
    created.set(a.payload.source_id, (created.get(a.payload.source_id) ?? new Set()).add(a.issue_id));
  }
  return { units, titles, created };
}
