// The daily re-score: every open issue's priority recomputed from its stored inputs (no LLM), so older reports count
// for less and quiet issues leave Rising. Logged like any other change.
import { serviceDb } from "@/lib/db/server";
import { slackEnabled } from "@/lib/env";
import { agedChange, agedScore } from "@/lib/scoring";
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, type IssueType, type Lane, type Thresholds, type Weights } from "@/lib/types";

export async function refreshPriorities(projectId: string, now = Date.now()): Promise<{ changed: number }> {
  const db = serviceDb();
  const { data: p } = await db.from("projects").select("score_weights, thresholds").eq("id", projectId).single();
  const w = (p?.score_weights as Weights | null) ?? DEFAULT_WEIGHTS, t = (p?.thresholds as Thresholds | null) ?? DEFAULT_THRESHOLDS;
  const { data: issues } = await db.from("issues").select("id, importance, ease, type, lane, score_breakdown").eq("project_id", projectId).not("status", "in", "(shipped,dismissed)");
  const ids = (issues ?? []).map((i) => i.id as string);
  if (!ids.length) return { changed: 0 };
  const weekAgo = new Date(now - 7 * 86_400_000).toISOString();
  // By when the feedback happened, as rescoreIssue counts it.
  const { data: recent } = await db.from("feedback_units").select("issue_id").in("issue_id", ids).gte("occurred_at", weekAgo);
  const count = new Map<string, number>();
  for (const u of recent ?? []) count.set(u.issue_id, (count.get(u.issue_id) ?? 0) + 1);

  const moved: string[] = [];
  for (const i of issues ?? []) {
    const r = agedScore({ importance: i.importance, ease: i.ease, type: i.type as IssueType, lane: i.lane as Lane | null, breakdown: i.score_breakdown }, count.get(i.id) ?? 0, now, w, t);
    if (!r) continue;
    const { patch, log } = agedChange(i, r, now);
    await db.from("issues").update(patch).eq("id", i.id);
    if (log.length) await db.from("activity").insert(log);
    moved.push(i.id);
  }
  // The Slack sweep follows activity, which skips drift under 3 points, so bring every moved card up to date here.
  if (moved.length && slackEnabled()) await (await import("@/lib/slack/sync")).syncIssuesToSlack(moved);
  return { changed: moved.length };
}
