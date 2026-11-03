import { describe, it, expect } from "vitest";
import { solveDecision } from "@/lib/actions/solveDecision";

describe("solveDecision", () => {
  it("404 when the issue is not visible to the user (wins over everything)", () => {
    expect(solveDecision({ visible: false, lane: "quick_win", hasDispatchedDraft: true })).toBe(404);
  });
  it("409 when a draft is already in flight", () => {
    expect(solveDecision({ visible: true, lane: "quick_win", hasDispatchedDraft: true })).toBe(409);
    expect(solveDecision({ visible: true, lane: "watch", hasDispatchedDraft: true })).toBe(409);
  });
  it("400 unless the lane is quick_win or explore", () => {
    for (const lane of ["watch", "backlog", null, undefined]) expect(solveDecision({ visible: true, lane, hasDispatchedDraft: false })).toBe(400);
  });
  it("409 while the issue is drafting (a solve has claimed it), unless its latest dispatch is stale", () => {
    expect(solveDecision({ visible: true, lane: "quick_win", hasDispatchedDraft: false, status: "drafting" })).toBe(409);
    expect(solveDecision({ visible: true, lane: "quick_win", hasDispatchedDraft: false, status: "drafting", latestDraftStale: false })).toBe(409);
    expect(solveDecision({ visible: true, lane: "quick_win", hasDispatchedDraft: false, status: "drafting", latestDraftStale: true })).toBe("go");
    expect(solveDecision({ visible: false, lane: "quick_win", hasDispatchedDraft: false, status: "drafting" })).toBe(404);
  });
  it("go for quick_win and explore with no draft in flight", () => {
    expect(solveDecision({ visible: true, lane: "quick_win", hasDispatchedDraft: false, status: "draft_ready" })).toBe("go");
    expect(solveDecision({ visible: true, lane: "quick_win", hasDispatchedDraft: false })).toBe("go");
    expect(solveDecision({ visible: true, lane: "explore", hasDispatchedDraft: false })).toBe("go");
  });
});
