import { describe, it, expect } from "vitest";
import { DRAFT_STALE_MS, isStaleDispatch, canRedraft, draftingRetryable, isNewestDraft, claimPlan } from "@/lib/drafts/inflight";

const now = Date.parse("2026-10-14T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("DRAFT_STALE_MS", () => {
  it("is 45 minutes (workflow timeout is 30)", () => expect(DRAFT_STALE_MS).toBe(45 * 60_000));
});

describe("isStaleDispatch", () => {
  it("only dispatched drafts older than the limit are stale", () => {
    expect(isStaleDispatch({ status: "dispatched", created_at: ago(DRAFT_STALE_MS + 1) }, now)).toBe(true);
    expect(isStaleDispatch({ status: "dispatched", created_at: ago(DRAFT_STALE_MS - 1) }, now)).toBe(false);
    expect(isStaleDispatch({ status: "failed", created_at: ago(DRAFT_STALE_MS * 3) }, now)).toBe(false);
    expect(isStaleDispatch(null, now)).toBe(false);
  });
});

describe("canRedraft", () => {
  it("true with no draft or a finished draft", () => {
    expect(canRedraft(null, now)).toBe(true);
    expect(canRedraft(undefined, now)).toBe(true);
    expect(canRedraft({ status: "ready", created_at: ago(1000) }, now)).toBe(true);
    expect(canRedraft({ status: "failed", created_at: ago(1000) }, now)).toBe(true);
  });
  it("false while a fresh draft is dispatched, true once it is stale", () => {
    expect(canRedraft({ status: "dispatched", created_at: ago(10 * 60_000) }, now)).toBe(false);
    expect(canRedraft({ status: "dispatched", created_at: ago(DRAFT_STALE_MS + 60_000) }, now)).toBe(true);
  });
  it("false when created_at is unparseable (never retry blindly)", () => {
    expect(canRedraft({ status: "dispatched", created_at: "nope" }, now)).toBe(false);
  });
});

describe("draftingRetryable", () => {
  it("a drafting issue is retryable only when its latest draft is a stale dispatch", () => {
    expect(draftingRetryable({ status: "dispatched", created_at: ago(DRAFT_STALE_MS + 1) }, now)).toBe(true);
    expect(draftingRetryable({ status: "dispatched", created_at: ago(60_000) }, now)).toBe(false);
    // No draft row yet: another solve has claimed the issue and is still proposing solutions.
    expect(draftingRetryable(null, now)).toBe(false);
  });
});

describe("isNewestDraft", () => {
  const drafts = [
    { id: "a", created_at: "2026-10-14T10:00:00Z" },
    { id: "b", created_at: "2026-10-14T11:00:00Z" },
  ];
  it("true only for the latest draft of the issue", () => {
    expect(isNewestDraft("b", drafts)).toBe(true);
    expect(isNewestDraft("a", drafts)).toBe(false);
  });
  it("handles different timestamp formats and a single draft", () => {
    expect(isNewestDraft("a", [{ id: "a", created_at: "2026-10-14T10:00:00.123456+00:00" }, { id: "b", created_at: "2026-10-14T09:59:59Z" }])).toBe(true);
    expect(isNewestDraft("x", [{ id: "x", created_at: "2026-10-14T10:00:00Z" }])).toBe(true);
  });
  it("ties break deterministically by id; unknown id is not newest", () => {
    const tie = [{ id: "a", created_at: "2026-10-14T10:00:00Z" }, { id: "b", created_at: "2026-10-14T10:00:00Z" }];
    expect(isNewestDraft("b", tie)).toBe(true);
    expect(isNewestDraft("a", tie)).toBe(false);
    expect(isNewestDraft("z", drafts)).toBe(false);
  });
});

describe("claimPlan", () => {
  it("claims a non-drafting issue and remembers its status for restore", () => {
    expect(claimPlan("new", null, now)).toEqual({ kind: "claim", prev: "new" });
    expect(claimPlan("draft_ready", { id: "d1", status: "ready", created_at: ago(1000) }, now)).toEqual({ kind: "claim", prev: "draft_ready" });
  });
  it("takes over a drafting issue only from a stale dispatch, restoring to new on failure", () => {
    expect(claimPlan("drafting", { id: "d1", status: "dispatched", created_at: ago(DRAFT_STALE_MS + 1000) }, now)).toEqual({ kind: "take_stale", draftId: "d1", prev: "new" });
  });
  it("is busy while another solve holds the claim or a fresh draft is in flight", () => {
    expect(claimPlan("drafting", null, now)).toEqual({ kind: "busy" });
    expect(claimPlan("drafting", { id: "d1", status: "dispatched", created_at: ago(60_000) }, now)).toEqual({ kind: "busy" });
    expect(claimPlan("drafting", { id: "d1", status: "failed", created_at: ago(DRAFT_STALE_MS * 2) }, now)).toEqual({ kind: "busy" });
  });
});
