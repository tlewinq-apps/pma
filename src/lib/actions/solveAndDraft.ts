/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";
import { callStructured } from "@/lib/llm/client";
import { withIssueClaude } from "@/lib/llm/scope";
import { proposeSolutions } from "@/lib/pipeline/solve";
import { dispatchDraft } from "@/lib/github/dispatch";
import { claimPlan } from "@/lib/drafts/inflight";
import { isStaleMockup } from "@/lib/drafts/codeMockup";
import { regeneratePlan } from "@/lib/proposals";
import type { DiagnosisFinding } from "@/lib/diagnosis/model";
import { profileOfEmbedded } from "@/lib/product/profile";

type Claim = { prev: string };

/**
 * Claims the issue for one solve/draft run by moving it to `drafting` atomically (see claimPlan). Returns null when
 * another run owns it, after logging `draft_skipped`. The status update is compare-and-set on the status just read,
 * so two concurrent callers cannot both claim it.
 */
export async function claimIssueForDraft(db: SupabaseClient, issueId: string): Promise<Claim | null> {
  const { data: i, error } = await db.from("issues").select("id,status,projects(kind)").eq("id", issueId).maybeSingle();
  if (error) throw new Error(`claim: load issue failed: ${error.message}`);
  if (!i) return null;
  const { data: latest, error: dErr } = await db.from("drafts").select("id,status,created_at,backend").eq("issue_id", issueId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (dErr) throw new Error(`claim: load draft failed: ${dErr.message}`);
  const kind = (i as { projects?: { kind?: string } | null }).projects?.kind;
  const plan = claimPlan(i.status, latest, Date.now(), !!kind && isStaleMockup(latest, { kind }, Date.now()));
  if (plan.kind === "claim") {
    const { data, error: uErr } = await db.from("issues").update({ status: "drafting" }).eq("id", issueId).eq("status", plan.prev).select("id");
    if (uErr) throw new Error(`claim: update issue failed: ${uErr.message}`);
    if (data?.length) return { prev: plan.prev };
  } else if (plan.kind === "take_stale") {
    // The wedged draft is marked failed; only the caller whose update flips it wins the claim.
    const { data, error: uErr } = await db.from("drafts").update({ status: "failed" }).eq("id", plan.draftId).eq("status", "dispatched").select("id");
    if (uErr) throw new Error(`claim: release stale draft failed: ${uErr.message}`);
    if (data?.length) return { prev: plan.prev };
  }
  await db.from("activity").insert({ issue_id: issueId, kind: "draft_skipped", payload: { reason: "draft in progress" } });
  return null;
}

async function restoreStatus(db: SupabaseClient, issueId: string, claim: Claim): Promise<void> {
  const { error } = await db.from("issues").update({ status: claim.prev }).eq("id", issueId);
  if (error) console.error("[solveAndDraft] restoring issue status failed", error.message);
}

/** Runs `work` under a claim; restores the pre-claim status unless `work` dispatched a draft. Errors are rethrown after the restore. */
async function withClaim(issueId: string, work: (db: SupabaseClient) => Promise<boolean>): Promise<void> {
  const db = serviceDb();
  const claim = await claimIssueForDraft(db, issueId);
  if (!claim) return;
  let dispatched = false;
  try {
    dispatched = await work(db);
  } finally {
    if (!dispatched) await restoreStatus(db, issueId, claim);
  }
}

/** Asks the model for `count` options and saves them beside any PM work. Returns every solution of the issue. */
async function saveProposals(db: SupabaseClient, issueId: string, count: 1 | 3, diagnosis: DiagnosisFinding | null = null): Promise<{ id: string; recommended: boolean; target_frames: string[] | null }[] | null> {
  const { data: i, error: iErr } = await db.from("issues").select("id,title,problem_statement,type,project_id,jobs(current_flow_md),issue_screens(position,screens(frame_id,title)),projects(kind,product_profile,name)").eq("id", issueId).single();
  if (iErr) throw new Error(`saveProposals: load issue failed: ${iErr.message}`);
  if (!i) return null;
  const flow = [...((i as any).issue_screens ?? [])].sort((a: any, b: any) => a.position - b.position).map((s: any) => ({ frame_id: s.screens.frame_id, title: s.screens.title }));
  const options = await proposeSolutions(callStructured, i, count, flow, (i as any).jobs?.current_flow_md ?? null, diagnosis, profileOfEmbedded((i as any).projects, "saveProposals"));
  // PM-written and PM-edited proposals survive a re-propose; only PMA's untouched ones are replaced.
  const { data: existing, error: exErr } = await db.from("solutions").select("id,origin,edited_at,rank,recommended").eq("issue_id", issueId);
  if (exErr) throw new Error(`saveProposals: load solutions failed: ${exErr.message}`);
  const plan = regeneratePlan(existing ?? []);
  if (plan.deleteIds.length) {
    const { error: delErr } = await db.from("solutions").delete().in("id", plan.deleteIds);
    if (delErr) throw new Error(`saveProposals: clearing solutions failed: ${delErr.message}`);
  }
  const { error: insErr } = await db.from("solutions").insert(options.map((o, k) => ({ issue_id: issueId, rank: plan.nextRank + k, title: o.title, summary: o.summary, tradeoffs: o.tradeoffs, effort: o.effort, risk: o.risk, recommended: plan.keptRecommended ? false : o.recommended, mode: o.mode, target_frames: o.target_frames })));
  if (insErr) throw new Error(`saveProposals: saving solutions failed: ${insErr.message}`);
  const { data: all, error: allErr } = await db.from("solutions").select("id,recommended,target_frames").eq("issue_id", issueId);
  if (allErr) throw new Error(`saveProposals: reload solutions failed: ${allErr.message}`);
  return all ?? [];
}

export async function solveAndDraft(issueId: string, count: 1 | 3): Promise<void> {
  await withIssueClaude(issueId, () => withClaim(issueId, async (db) => {
    const saved = await saveProposals(db, issueId, count);
    const rec = saved?.find((s) => s.recommended);
    if (!rec) return false;
    if (!rec.target_frames?.length) {
      await db.from("activity").insert({ issue_id: issueId, kind: "draft_skipped", payload: { reason: "no target frames" } });
      return false;
    }
    return dispatchDraft(issueId, rec.id);
  }));
}

/**
 * Proposes options without drafting (Write proposals in the workspace, Take it on in Slack, and right after a bug's
 * diagnosis, whose finding the options must address). Callers refuse while a draft is in flight.
 */
export async function proposeOnly(issueId: string, count: 1 | 3, opts: { diagnosis?: DiagnosisFinding | null } = {}): Promise<void> {
  const db = serviceDb();
  await withIssueClaude(issueId, () => saveProposals(db, issueId, count, opts.diagnosis ?? null));
  await db.from("activity").insert({ issue_id: issueId, kind: "proposals_ready", payload: { count, ...(opts.diagnosis ? { from_diagnosis: true } : {}) } });
}

/** Drafts a specific option (Implement, Retry, Request changes) under the same claim as solveAndDraft. */
export async function draftSolution(issueId: string, solutionId: string, opts: { note?: string } = {}): Promise<boolean> {
  let dispatched = false;
  await withIssueClaude(issueId, () => withClaim(issueId, async () => (dispatched = await dispatchDraft(issueId, solutionId, opts))));
  return dispatched;
}
