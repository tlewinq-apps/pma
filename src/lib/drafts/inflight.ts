// Pure draft-concurrency rules shared by dispatch, the solve/draft routes and the (client) drawer. No server imports.

/** The draft workflow times out at 30 min; a draft still `dispatched` after this is wedged and no longer blocks a retry. */
export const DRAFT_STALE_MS = 45 * 60_000;

export type DraftLite = { status: string; created_at: string } | null | undefined;

/** A `dispatched` draft older than DRAFT_STALE_MS. Unparseable timestamps are never stale. */
export function isStaleDispatch(draft: DraftLite, now: number): boolean {
  if (!draft || draft.status !== "dispatched") return false;
  const t = Date.parse(draft.created_at);
  return Number.isFinite(t) && now - t > DRAFT_STALE_MS;
}

/** The drawer offers Draft fix / Re-draft unless the latest draft is still in flight. */
export function canRedraft(draft: DraftLite, now: number): boolean {
  if (!draft || draft.status !== "dispatched") return true;
  return isStaleDispatch(draft, now);
}

/**
 * An issue in `drafting` is retryable only when its latest draft is a stale dispatch. With no draft row the
 * `drafting` status is a live claim by another solve (still proposing solutions), so it is not retryable.
 */
export function draftingRetryable(latest: DraftLite, now: number): boolean {
  return isStaleDispatch(latest, now);
}

/** True when `draftId` is the issue's newest draft by created_at (ties broken by the larger id). */
export function isNewestDraft(draftId: string, drafts: { id: string; created_at: string }[]): boolean {
  let best: { id: string; t: number } | null = null;
  for (const d of drafts) {
    const t = Date.parse(d.created_at);
    if (!Number.isFinite(t)) continue;
    if (!best || t > best.t || (t === best.t && d.id > best.id)) best = { id: d.id, t };
  }
  return best?.id === draftId;
}

export type ClaimPlan = { kind: "claim"; prev: string } | { kind: "take_stale"; draftId: string; prev: string } | { kind: "busy" };

/**
 * How solveAndDraft claims an issue before proposing solutions:
 * - not `drafting` → compare-and-set status prev → drafting (prev is restored on any exit that does not dispatch);
 * - `drafting` with a stale latest dispatch → atomically mark that draft failed (only one caller wins) and keep
 *   `drafting`; restore goes to `new`, as when a dispatch fails;
 * - otherwise another solve or a live draft owns it → busy.
 */
export function claimPlan(status: string, latest: ({ id: string } & NonNullable<DraftLite>) | null | undefined, now: number, latestKilled = false): ClaimPlan {
  if (status !== "drafting") return { kind: "claim", prev: status };
  // `latestKilled`: an approximate mock-up past MOCKUP_STALE_MS (drafts/codeMockup.ts isStaleMockup), which can't finish.
  if (latest && (latestKilled || draftingRetryable(latest, now))) return { kind: "take_stale", draftId: latest.id, prev: "new" };
  return { kind: "busy" };
}
