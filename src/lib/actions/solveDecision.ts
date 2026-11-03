/**
 * Pure decision for POST /api/issues/[id]/solve: which HTTP status to return, or "go" to run solveAndDraft.
 * `status === "drafting"` means another solve/draft owns the issue, unless its latest dispatch is stale (wedged).
 */
export function solveDecision(o: { visible: boolean; lane: string | null | undefined; hasDispatchedDraft: boolean; status?: string | null; latestDraftStale?: boolean }): 404 | 409 | 400 | "go" {
  if (!o.visible) return 404;
  if (o.hasDispatchedDraft) return 409;
  if (o.status === "drafting" && !o.latestDraftStale) return 409;
  if (o.lane !== "quick_win" && o.lane !== "explore") return 400;
  return "go";
}
