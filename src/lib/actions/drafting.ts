// Mock it up (start a draft of a proposal) and Request changes, shared by the workspace routes and Slack.
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";
import { hasDraftInProgress } from "@/lib/github/dispatch";
import { isStaleDispatch } from "@/lib/drafts/inflight";
import { draftSolution } from "./solveAndDraft";
import { closeSupersededPr, type ActionResult } from "./approve";
import { logLaneActionFailed } from "./laneFailure";
import { awaitingDiagnosis, parseDiagnosis } from "@/lib/diagnosis/model";
import { checkFirst } from "@/lib/diagnosis/checks";
import { isStaleMockup, mockupRefusal } from "@/lib/drafts/codeMockup";

/**
 * Starts a draft of `solutionId`. Awaited (not after()) so callers already see `drafting` when it returns. A customer
 * app's proposal with no screens is drawn from its code, so it is refused here, in one plain sentence, when there is no
 * repository or the first step found no code to draw from.
 */
export async function startDraft(db: SupabaseClient, issueId: string, solutionId: string): Promise<ActionResult> {
  const { data } = await db.from("solutions").select("id,target_frames,issues(lane,status,type,diagnosis,projects(kind,repo_full_name))").eq("id", solutionId).eq("issue_id", issueId).maybeSingle();
  if (!data) return { ok: false, status: 400, error: "unknown solution" };
  const row = data as { target_frames?: string[] | null; issues?: { lane?: string | null; status?: string | null; type?: string; diagnosis?: unknown; projects?: { kind?: string; repo_full_name?: string | null } | null } | null };
  const issue = row.issues;
  const diagnosis = parseDiagnosis(issue?.diagnosis);
  if (issue?.type && awaitingDiagnosis(issue.type, diagnosis)) return { ok: false, status: 409, error: checkFirst(issue.type) };
  const app = issue?.projects;
  const refused = app ? mockupRefusal({ kind: app.kind, repo_full_name: app.repo_full_name }, row.target_frames, diagnosis) : null;
  if (refused) return { ok: false, status: 409, error: refused };
  const { data: latest } = await db.from("drafts").select("status,created_at,backend").eq("issue_id", issueId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  // An approximate mock-up whose run was killed shows Retry after MOCKUP_STALE_MS, well before DRAFT_STALE_MS frees a
  // GitHub draft; the claim then marks it failed (solveAndDraft claimIssueForDraft).
  const killed = !!app?.kind && isStaleMockup(latest, { kind: app.kind }, Date.now());
  const busy = !killed && (await hasDraftInProgress(db, issueId) || (issue?.status === "drafting" && !isStaleDispatch(latest, Date.now())));
  if (busy) return { ok: false, status: 409, error: "draft in progress" };
  try {
    const started = await draftSolution(issueId, solutionId); // claims the issue like solveAndDraft; logs draft_skipped if another run owns it
    if (!started) return { ok: false, status: 409, error: "The draft didn't start. The activity log has the reason." };
  } catch (e) {
    await logLaneActionFailed(issueId, issue?.lane ?? "explore", e);
    return { ok: false, status: 500, error: "Couldn't start the draft" };
  }
  return { ok: true };
}

/** A customer's approved mock-up (or a shipped issue) isn't re-drafted by Request changes: that would drop the approval. */
export const APPROVED_NO_CHANGES = "This mock-up is already approved, so it can't be re-drafted. To build something else, mock up another proposal.";

/**
 * Re-drafts the reviewed proposal with the reviewer's note, then closes the PR it replaces. `note` is already validated.
 * Refused once the issue is Ready to build or Shipped: a customer app's approximate mock-up keeps its pull request
 * "open" after approval (there is none), so the draft alone would let a re-draft quietly undo the approval.
 */
export async function requestChanges(db: SupabaseClient, issueId: string, userId: string, note: string): Promise<ActionResult> {
  const { data: issue } = await db.from("issues").select("id, lane, status, projects(repo_full_name, kind)").eq("id", issueId).maybeSingle();
  if (!issue) return { ok: false, status: 404, error: "not found" };
  if (issue.status === "ready_to_build") return { ok: false, status: 409, error: APPROVED_NO_CHANGES };
  const { data: prev } = await db.from("drafts").select("id, status, solution_id, demo, backend, pr_number, pr_state").eq("issue_id", issueId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!prev || prev.status !== "ready" || prev.pr_state === "merged" || !prev.solution_id) return { ok: false, status: 409, error: "There's no draft to revise" };
  // A customer issue marked shipped by hand keeps its approximate draft "open" (the demo's shipped drafts are merged, above).
  if (issue.status === "shipped") return { ok: false, status: 409, error: APPROVED_NO_CHANGES };

  await serviceDb().from("activity").insert({ issue_id: issueId, user_id: userId, kind: "changes_requested", payload: { note, draft_id: prev.id } });
  try {
    const started = await draftSolution(issueId, prev.solution_id, { note });
    if (!started) return { ok: false, status: 409, error: "The draft didn't start. The activity log has the reason." };
  } catch (e) {
    await logLaneActionFailed(issueId, issue.lane ?? "", e);
    return { ok: false, status: 500, error: "Couldn't start the revised draft" };
  }
  const app = (issue as { projects?: { repo_full_name?: string | null; kind?: string | null } | null }).projects;
  const repo = app?.repo_full_name;
  // Only a real GitHub draft has a pull request to close (demo and mock-runner drafts live in this app), and only the
  // demo app's (closeSupersededPr refuses any other app: the deployment's token acts for the demo app alone).
  if (prev.backend === "github" && !prev.demo && prev.pr_number && repo) await closeSupersededPr({ repo_full_name: repo, kind: app?.kind }, prev.pr_number);
  return { ok: true };
}
