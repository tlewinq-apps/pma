import { describe, it, expect } from "vitest";
import { approvePlan, solutionText, parseNote } from "@/lib/drafts/review";

const ready = { id: "d1", status: "ready", demo: false, pr_number: 12, pr_state: "open" };

describe("approvePlan", () => {
  it("merges a ready GitHub draft by PR number", () => expect(approvePlan(ready)).toEqual({ kind: "github", prNumber: 12 }));
  it("ships a ready demo draft without GitHub", () => expect(approvePlan({ ...ready, demo: true, pr_number: null })).toEqual({ kind: "demo" }));
  it("ships a ready mock-runner draft without GitHub, even though it has a PR number", () => expect(approvePlan({ ...ready, backend: "mock" })).toEqual({ kind: "mock" }));
  it("refuses when there is nothing ready to merge", () => {
    expect(approvePlan(null)).toEqual({ kind: "error", reason: "no_draft" });
    expect(approvePlan({ ...ready, status: "dispatched" })).toEqual({ kind: "error", reason: "not_ready" });
    expect(approvePlan({ ...ready, status: "failed" })).toEqual({ kind: "error", reason: "not_ready" });
    expect(approvePlan({ ...ready, pr_state: "merged" })).toEqual({ kind: "error", reason: "already_merged" });
    expect(approvePlan({ ...ready, pr_state: "closed" })).toEqual({ kind: "error", reason: "closed" });
    expect(approvePlan({ ...ready, pr_number: null })).toEqual({ kind: "error", reason: "no_pr" });
  });
});

describe("solutionText", () => {
  it("joins title and summary", () => expect(solutionText("Sent states", "Show a confirmation.")).toBe("Sent states: Show a confirmation."));
  it("appends a reviewer note", () => expect(solutionText("Sent states", "Show it.", "Use the brand green")).toBe("Sent states: Show it.\n\nReviewer note: Use the brand green"));
});

describe("parseNote", () => {
  it("trims and accepts a note", () => expect(parseNote({ note: "  Bigger button  " })).toEqual({ note: "Bigger button" }));
  it("rejects empty, missing, non-string and over-long notes", () => {
    expect(parseNote({ note: "   " })).toEqual({ error: "Add a note describing the change" });
    expect(parseNote({})).toEqual({ error: "Add a note describing the change" });
    expect(parseNote({ note: 5 })).toEqual({ error: "Add a note describing the change" });
    expect(parseNote({ note: "x".repeat(1001) })).toEqual({ error: "Keep the note under 1000 characters" });
    expect(parseNote(null)).toEqual({ error: "Add a note describing the change" });
  });
});
