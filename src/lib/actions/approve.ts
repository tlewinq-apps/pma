/* eslint-disable @typescript-eslint/no-explicit-any */
import { serviceDb } from "@/lib/db/server";
import { octokit, splitRepo } from "@/lib/github/client";
import { approvePlan, APPROVE_ERROR } from "@/lib/drafts/review";
import { mayUseDeploymentToken } from "@/lib/drafts/demo";
import { isApproximate } from "@/lib/drafts/codeMockup";
import { BUILD_UNAVAILABLE, buildModeAvailable, defaultBuildMode, savedBuildBranch, type BuildMode } from "@/lib/handoff/build";
import { isBranchName } from "@/lib/settings";
import { buildCaps, startBuild } from "@/lib/build/start";

export type ActionResult = { ok: true } | { ok: false; status: number; error: string };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const ghStatus = (e: unknown) => (e && typeof e === "object" && "status" in e ? Number((e as { status: unknown }).status) : 0);

export const ALREADY_APPROVED = "This mock-up is already approved.";
export const NOT_IN_REVIEW = "This issue isn't waiting for a review, so there's nothing to approve.";
/** The issue statuses an approximate mock-up can be approved from: its draft is ready and nobody approved it yet. */
const REVIEWABLE = ["draft_ready", "in_review"];

/**
 * Approve and merge the latest draft. GitHub drafts get an approving review (ignored when GitHub refuses it, e.g.
 * approving your own PR) and a squash merge; demo drafts skip GitHub. Either way the issue becomes `shipped` now,
 * and the PR webhook that follows a real merge sets the same state again.
 *
 * A customer app's approximate mock-up (drawn from its code, with no pull request behind it) is only approved: the
 * issue becomes `ready_to_build` and nobody who raised it is told anything (spec call 11). It ships when a linked code
 * pull request merges. The demo app keeps the behaviour above.
 *
 * Approving one also says how it gets built (`build`, lib/handoff/build.ts): what was picked on the page, else the
 * app's saved default (Slack's Approve button picks nothing). A pull-request way starts Build it (lib/build) once the
 * approval lands, when the company's GitHub installation can write; `origin` is this deployment, for its run. Only the
 * issue's review states can be approved, and the status changes only from them, so a dismissed or shipped issue never
 * comes back and two approvals can't both land.
 */
export async function approveAndMerge(issueId: string, userId: string, opts: { build?: BuildMode; branch?: string | null; origin?: string } = {}): Promise<ActionResult> {
  const db = serviceDb();
  const { data: issue } = await db.from("issues").select("id, status, project_id, projects(repo_full_name, kind, settings, org_id)").eq("id", issueId).single();
  const { data: d } = await db.from("drafts").select("id, status, demo, backend, pr_number, pr_state, pr_url").eq("issue_id", issueId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const plan = approvePlan(d);
  if (plan.kind === "error") return { ok: false, status: 409, error: APPROVE_ERROR[plan.reason] };

  // An unknown kind counts as a customer app here: approving must never ship a customer's issue by mistake.
  const kind = ((issue as any)?.projects?.kind as string | null | undefined) ?? "";
  if (plan.kind === "mock" && isApproximate(d, { kind })) {
    const status = (issue as any)?.status as string | undefined;
    if (status === "ready_to_build") return { ok: false, status: 409, error: ALREADY_APPROVED };
    if (!status || !REVIEWABLE.includes(status)) return { ok: false, status: 409, error: NOT_IN_REVIEW };
    const settings = (issue as any)?.projects?.settings;
    const caps = await buildCaps((issue as any)?.projects?.org_id ?? "");
    const build = opts.build ?? defaultBuildMode(settings, caps);
    if (!buildModeAvailable(build, caps)) return { ok: false, status: 409, error: BUILD_UNAVAILABLE };
    const branch = build === "branch" ? (opts.branch ?? savedBuildBranch(settings))?.trim() || null : null;
    if (build === "branch" && (!branch || !isBranchName(branch))) return { ok: false, status: 400, error: "Name the branch to add the change to." };
    if (build !== "claude_code" && !opts.origin) return { ok: false, status: 409, error: BUILD_UNAVAILABLE };
    // Only from a review state: of two approvals at once, the second finds nothing to change.
    const { data: moved, error } = await db.from("issues").update({ status: "ready_to_build", updated_at: new Date().toISOString() })
      .eq("id", issueId).in("status", REVIEWABLE).select("id");
    if (error) return { ok: false, status: 500, error: "Couldn't record the approval. Try again." };
    if (!moved?.length) return { ok: false, status: 409, error: ALREADY_APPROVED };
    await db.from("activity").insert({ issue_id: issueId, user_id: userId, kind: "approved", payload: { mock: true, approximate: true, draft_id: d!.id, build, ...(branch ? { branch } : {}) } });
    if (build !== "claude_code") {
      // The approval stands even if the build can't be queued: Try again on the issue starts it.
      await startBuild({ issueId, projectId: (issue as any).project_id, mode: build, branch, userId, origin: opts.origin! }, db)
        .catch((e: Error) => console.error("[build] couldn't queue the build after approval", issueId, e.message));
    }
    return { ok: true };
  }

  if (plan.kind === "github") {
    // Only the demo app may merge with the deployment's token; a customer app's draft never reaches GitHub from here.
    if (!mayUseDeploymentToken((issue as any)?.projects?.kind)) return { ok: false, status: 409, error: "Drafts for this app can't be merged on GitHub yet." };
    const full = (issue as any)?.projects?.repo_full_name as string | null;
    if (!full) return { ok: false, status: 409, error: "No design repo is connected" };
    const { owner, repo } = splitRepo(full);
    try {
      await octokit().pulls.createReview({ owner, repo, pull_number: plan.prNumber, event: "APPROVE" });
    } catch (e) {
      console.warn("[approve] review not recorded", ghStatus(e), errMsg(e));
    }
    try {
      await octokit().pulls.merge({ owner, repo, pull_number: plan.prNumber, merge_method: "squash" });
    } catch (e) {
      return { ok: false, status: 409, error: `GitHub couldn't merge the PR: ${errMsg(e)}` };
    }
  }

  await db.from("drafts").update({ pr_state: "merged" }).eq("id", d!.id);
  await db.from("issues").update({ status: "shipped", updated_at: new Date().toISOString() }).eq("id", issueId);
  await db.from("activity").insert({ issue_id: issueId, user_id: userId, kind: "approved", payload: plan.kind === "demo" ? { demo: true, draft_id: d!.id }
    : plan.kind === "mock" ? { mock: true, pr_url: d!.pr_url, draft_id: d!.id }
    : { pr_url: d!.pr_url, pr_number: plan.prNumber, draft_id: d!.id } });
  // Close the loop: everyone who raised it in Slack hears it shipped, in their own thread (never throws).
  await (await import("@/lib/slack/reporters")).tellReporters(issueId);
  return { ok: true };
}

/**
 * Closes a PR that a newer draft replaced. Best effort: the webhook ignores closes of superseded drafts anyway. Only
 * for the demo app, the one app the deployment's token acts for.
 */
export async function closeSupersededPr(app: { repo_full_name: string; kind: string | null | undefined }, prNumber: number): Promise<void> {
  if (!mayUseDeploymentToken(app.kind)) return;
  try {
    await octokit().pulls.update({ ...splitRepo(app.repo_full_name), pull_number: prNumber, state: "closed" });
  } catch (e) {
    console.warn("[request changes] closing superseded PR failed", errMsg(e));
  }
}
