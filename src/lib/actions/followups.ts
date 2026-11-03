/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase nested selects are untyped */
import { serviceDb } from "@/lib/db/server";
import { callStructured } from "@/lib/llm/client";
import { withIssueClaude } from "@/lib/llm/scope";
import { draftFollowups, type Followups } from "@/lib/followups";
import { profileOfEmbedded } from "@/lib/product/profile";

/** Drafts follow-up questions once per issue, when its clarity is rated low (rescoreIssue's onScored hook). */
export async function draftFollowupsIfNone(issueId: string): Promise<void> {
  const db = serviceDb();
  const { data: i } = await db.from("issues").select("title, problem_statement, followups, feedback_units(quote), projects(kind, product_profile, name)").eq("id", issueId).single();
  if (!i || (i as any).followups) return;
  const questions = await withIssueClaude(issueId, () => draftFollowups(callStructured, { title: i.title, problem: i.problem_statement, quotes: ((i as any).feedback_units ?? []).map((u: any) => u.quote) }, profileOfEmbedded((i as any).projects, "followups")));
  if (!questions.length) return;
  const followups: Followups = { questions, drafted_at: new Date().toISOString() };
  // Only the first draft wins: a concurrent rescore finds the column already set.
  const { data: set } = await db.from("issues").update({ followups }).eq("id", issueId).is("followups", null).select("id");
  if (set?.length) await db.from("activity").insert({ issue_id: issueId, kind: "followups_drafted", payload: { questions } });
}
