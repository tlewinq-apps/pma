// Shipping a customer issue (spec call 11): it ships when its linked code pull request merges. The PMA GitHub App's
// webhook says so (`via: "github"`, with no person behind it), or an owner or admin marks it by hand once a pull
// request is linked. Either way it takes the same shipped path as everything else: the issue's status becomes `shipped` (which the Desk, the
// digest's "shipped this week" and the Slack card read), the activity says so, and everyone who raised it in Slack
// hears it shipped in their own thread. The route syncs the Slack card. The demo app never gets here.
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";
import { SHIP_ALREADY, SHIP_NEEDS_PR, SHIP_NOT_READY } from "@/lib/handoff/build";
import type { ActionResult } from "./approve";

export async function markShipped(issueId: string, userId: string | null, db: SupabaseClient = serviceDb(), opts: { via?: "github"; prNumber?: number } = {}): Promise<ActionResult> {
  const { data: issue } = await db.from("issues").select("id, status, projects(kind)").eq("id", issueId).maybeSingle();
  if (!issue) return { ok: false, status: 404, error: "not found" };
  const kind = (issue as { projects?: { kind?: string } | null }).projects?.kind;
  if (kind === "demo") return { ok: false, status: 409, error: "The demo app ships when its mock-up is approved." };
  // Shipped already is its own answer: a merge on GitHub ships it on its own, often while someone has the page open.
  if (issue.status === "shipped") return { ok: false, status: 409, error: SHIP_ALREADY };
  if (issue.status !== "ready_to_build") return { ok: false, status: 409, error: SHIP_NOT_READY };
  const { data: links } = await db.from("pull_request_links").select("id, url, number, repo, state, created_at").eq("issue_id", issueId).order("created_at", { ascending: false });
  const all = (links ?? []) as { url: string; number: number; repo: string }[];
  // Shipped by a merge: the pull request that merged; by hand: the newest one linked.
  const latest = (opts.prNumber ? all.find((l) => l.number === opts.prNumber) : undefined) ?? all[0];
  if (!latest) return { ok: false, status: 409, error: SHIP_NEEDS_PR };

  // The order keeps every failure safe to retry (step 1 only touches open links, and the flip is conditional):
  // 1. the open links become merged first (on failure nothing has changed);
  // 2. then the status flips, only from Ready to build, so two presses at once ship it once. If it didn't flip and
  //    nobody else shipped it, the links go back to open. If even the status can't be read back, the links are left
  //    merged: the next press finds nothing open, and flips the status;
  // 3. a link can be added between 1 and 2, so after the flip the open links become merged once more. That leaves a
  //    far smaller window (a link request that read the status before the flip and inserts after this sweep), which
  //    these separate writes can't close entirely; a failed sweep is logged, since the issue has shipped;
  // 4. then the activity and the reporters, which can't undo the ship (a failed activity row is logged).
  const failed = { ok: false as const, status: 500, error: "Couldn't mark it shipped. Try again." };
  const { error: linkError } = await db.from("pull_request_links").update({ state: "merged" }).eq("issue_id", issueId).eq("state", "open");
  if (linkError) return failed;
  const { data: moved, error } = await db.from("issues").update({ status: "shipped", updated_at: new Date().toISOString() })
    .eq("id", issueId).eq("status", "ready_to_build").select("id");
  if (error || !moved?.length) {
    const { data: now, error: readError } = await db.from("issues").select("status").eq("id", issueId).maybeSingle();
    if (readError) return failed; // can't tell whether someone else shipped it, so the links stay as they are
    if (now?.status === "shipped") return { ok: false, status: 409, error: SHIP_ALREADY }; // someone else shipped it first
    const { error: revertError } = await db.from("pull_request_links").update({ state: "open" }).eq("issue_id", issueId).eq("state", "merged");
    if (revertError) console.error("[ship] it didn't ship, and its links couldn't be put back to open", issueId, revertError.message);
    return error ? failed : { ok: false, status: 409, error: SHIP_NOT_READY };
  }
  const { error: sweepError } = await db.from("pull_request_links").update({ state: "merged" }).eq("issue_id", issueId).eq("state", "open");
  if (sweepError) console.error("[ship] shipped, but links added meanwhile weren't marked merged", issueId, sweepError.message);
  const { error: activityError } = await db.from("activity").insert({ issue_id: issueId, user_id: userId, kind: "shipped", payload: { ...(opts.via ? { via: opts.via } : { manual: true }), pr_url: latest.url, pr_number: latest.number, repo: latest.repo } });
  if (activityError) console.error("[ship] shipped, but the activity row wasn't written", issueId, activityError.message);
  // Close the loop, as a merged pull request does (never throws).
  await (await import("@/lib/slack/reporters")).tellReporters(issueId);
  return { ok: true };
}
