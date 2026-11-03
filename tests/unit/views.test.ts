import { describe, it, expect } from "vitest";
import { stageOf, stageLabel, suggestFirstIssue, viewMatches, parseView, groupRails, dominantEmotion, proposalSlot, attention, viewGroups, viewLabel } from "@/components/triage/views";
import type { IssueCardData } from "@/lib/queries/issues";
import type { Diagnosis } from "@/lib/diagnosis/model";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const DIAGNOSED: Diagnosis = { status: "done", started_at: "2026-10-15T11:00:00Z", finished_at: "2026-10-15T11:00:12Z", steps: [], finding: { headline: "The send times out.", cause: "The send times out.", facts: [], evidence: [], logging_added: [], where: "Pickup", confidence: "likely" } };

const base: IssueCardData = {
  id: "1", short_id: "a", title: "Early pickup fails silently", type: "bug", lane: "quick_win", importance: 86, ease: 85,
  people_count: 1, status: "new", owner: null, flow: "pickup › Early pickup", mean_sentiment: -2, emotion: "frustrated",
  scope: "single_screen", seen_by: [], top_quotes: [], proposal: { count: 1, title: "Explicit sent / failed states" },
  draft: null, job_code: "I05", audiences: ["parents"], severity: 5, urgency: null, urgency_raw: null, diagnosis: DIAGNOSED,
  last_activity_at: "2026-10-15T11:00:00Z", approved_at: null,
};
const mk = (o: Partial<IssueCardData>): IssueCardData => ({ ...base, ...o });
const draft = (status: string, solution_title: string | null = "Explicit sent / failed states") => ({ status, solution_title, demo: true, before: null, after: null });

describe("stageOf", () => {
  it("needs a proposal when there are no solutions", () => expect(stageOf(mk({ proposal: { count: 0, title: null } }))).toBe("needs_proposal"));
  it("is ready to implement with a proposal and no draft", () => expect(stageOf(base)).toBe("proposal_ready"));
  it("follows issue status for drafting, review, in review and shipped", () => {
    expect(stageOf(mk({ status: "drafting", draft: draft("dispatched") }))).toBe("drafting");
    expect(stageOf(mk({ status: "draft_ready", draft: draft("ready") }))).toBe("review");
    expect(stageOf(mk({ status: "in_review", draft: draft("ready") }))).toBe("in_review");
    expect(stageOf(mk({ status: "shipped", draft: draft("ready") }))).toBe("shipped");
  });
  it("holds an undiagnosed bug at diagnosis, whatever proposals it has", () => {
    expect(stageOf(mk({ diagnosis: null }), NOW)).toBe("needs_diagnosis");
    expect(stageOf(mk({ diagnosis: { ...DIAGNOSED, status: "failed" } }), NOW)).toBe("needs_diagnosis");
    expect(stageOf(mk({ diagnosis: { status: "running", started_at: "2026-10-15T11:59:55Z", steps: [] } }), NOW)).toBe("diagnosing");
  });
  it("lets a run that died with its server be run again", () => expect(stageOf(mk({ diagnosis: { status: "running", started_at: "2026-10-15T11:00:00Z", steps: [] } }), NOW)).toBe("needs_diagnosis"));
  it("holds every type at its first step, and never sends a drafted issue backwards", () => {
    expect(stageOf(mk({ type: "add_on", diagnosis: null }), NOW)).toBe("needs_diagnosis");
    expect(stageOf(mk({ type: "add_on" }), NOW)).toBe("proposal_ready");
    expect(stageOf(mk({ diagnosis: null, status: "draft_ready", draft: draft("ready") }), NOW)).toBe("review");
  });
  it("names the first-step stages in each type's words", () => {
    expect(stageLabel("needs_diagnosis", "bug")).toBe("Needs diagnosis");
    expect(stageLabel("needs_diagnosis", "new_feature")).toBe("Needs scoping");
    expect(stageLabel("diagnosing", "add_on")).toBe("Finding where it fits");
    expect(stageLabel("needs_diagnosis", "streamline")).toBe("Needs mapping");
    expect(stageLabel("review", "streamline")).toBe("Ready for review");
  });
  it("suggests a newcomer try the highest-priority issue still waiting on its first step, bugs first", () => {
    expect(suggestFirstIssue([mk({ id: "done" }), mk({ id: "feat", type: "new_feature", diagnosis: null, importance: 99 }), mk({ id: "bug-low", diagnosis: null, importance: 40 }), mk({ id: "bug-high", diagnosis: null, importance: 80 })])?.id).toBe("bug-high");
    expect(suggestFirstIssue([mk({ id: "done" })])).toBeNull();
  });
  it("reports a failed latest draft on a reopened issue", () => expect(stageOf(mk({ status: "new", draft: draft("failed") }))).toBe("failed"));
  it("lets a failed latest draft win over a stale review status", () => {
    expect(stageOf(mk({ status: "draft_ready", draft: draft("failed") }))).toBe("failed");
    expect(stageOf(mk({ status: "in_review", draft: draft("failed") }))).toBe("failed");
  });
});

describe("views", () => {
  const me = "me@x.com";
  const open = mk({ id: "open" });
  const shipped = mk({ id: "shipped", status: "shipped", draft: draft("ready") });
  const review = mk({ id: "review", status: "draft_ready", draft: draft("ready") });
  const failed = mk({ id: "failed", draft: draft("failed") });
  const bare = mk({ id: "bare", proposal: { count: 0, title: null }, lane: "watch", owner: { id: "u-me", email: me } });
  const fresh = mk({ id: "fresh", diagnosis: null, lane: "backlog" });
  const list = [open, shipped, review, failed, bare, fresh];
  const ids = (v: string) => list.filter((i) => viewMatches(parseView(v), i, me)).map((i) => i.id);

  it("All shows every open item and hides shipped", () => expect(ids("all")).toEqual(["open", "review", "failed", "bare", "fresh"]));
  it("stage views", () => {
    expect(ids("needs_diagnosis")).toEqual(["fresh"]);
    expect(ids("needs_proposal")).toEqual(["bare"]);
    expect(ids("ready_to_implement")).toEqual(["open", "failed"]);
    expect(ids("review")).toEqual(["review"]);
    expect(ids("shipped")).toEqual(["shipped"]);
  });
  it("priority, people and flow views exclude shipped", () => {
    expect(ids("quick_win")).toEqual(["open", "review", "failed"]);
    expect(ids("watch")).toEqual(["bare"]);
    expect(ids("mine")).toEqual(["bare"]);
    expect(ids("unassigned")).toEqual(["open", "review", "failed", "fresh"]);
    expect(ids("flow:pickup")).toEqual(["open", "review", "failed", "bare", "fresh"]);
    expect(ids("flow:calendar")).toEqual([]);
  });
  it("Mine matches nothing when signed-in email is unknown", () => expect(list.filter((i) => viewMatches("mine", i, null))).toEqual([]));
  it("parseView falls back to all for unknown input", () => {
    expect(parseView(null)).toBe("all");
    expect(parseView("nope")).toBe("all");
    expect(parseView("flow:")).toBe("all");
    expect(parseView("flow:pickup")).toBe("flow:pickup");
    expect(parseView("explore")).toBe("all"); // the lane views that were dropped
    expect(parseView("backlog")).toBe("all");
  });
  it("labels views in plain words", () => {
    expect(viewLabel("needs_diagnosis")).toBe("Needs a first step");
    expect(viewLabel("watch")).toBe("Rising");
    expect(viewLabel("review")).toBe("Ready for review");
    expect(viewLabel("flow:pickup")).toBe("Pickup");
  });
  it("lists Ready to build only when an issue is there, so the demo's stage views are unchanged", () => {
    const stages = (list: IssueCardData[]) => viewGroups(list).find((g) => g.label === "Stage")!.views;
    expect(stages([base, mk({ status: "shipped", draft: draft("ready") })])).toEqual(["needs_diagnosis", "needs_proposal", "ready_to_implement", "drafting", "review", "shipped"]);
    const ready = mk({ id: "r", status: "ready_to_build", draft: draft("ready") });
    expect(stages([base, ready])).toEqual(["needs_diagnosis", "needs_proposal", "ready_to_implement", "drafting", "review", "ready_to_build", "shipped"]);
    expect(stageOf(ready)).toBe("ready_to_build");
    expect(stageLabel("ready_to_build", "bug")).toBe("Ready to build");
    expect(parseView("ready_to_build")).toBe("ready_to_build");
    expect(viewLabel("ready_to_build")).toBe("Ready to build");
    expect(viewMatches("ready_to_build", ready, null)).toBe(true);
    expect(viewMatches("review", ready, null)).toBe(false);
    expect(viewMatches("shipped", ready, null)).toBe(false);
    expect(viewMatches("all", ready, null)).toBe(true);
  });

  it("offers one flow view per scene, sorted", () => {
    const flows = viewGroups([mk({ flow: "pickup › Early pickup" }), mk({ flow: "calendar › Week" }), mk({ flow: null })]).find((g) => g.label === "Flow")!;
    expect(flows.views).toEqual(["flow:calendar", "flow:pickup"]);
  });
});

describe("groupRails", () => {
  it("orders rails bugs, new features, add-ons, streamline and sorts each by priority", () => {
    const rails = groupRails([
      mk({ id: "s", type: "streamline", importance: 60 }), mk({ id: "b1", importance: 50 }), mk({ id: "a", type: "add_on" }),
      mk({ id: "b2", importance: 90 }), mk({ id: "bn", importance: null }),
    ]);
    expect(rails.map((r) => r.type)).toEqual(["bug", "new_feature", "add_on", "streamline"]);
    expect(rails[0].items.map((i) => i.id)).toEqual(["b2", "b1", "bn"]);
    expect(rails[1].items).toEqual([]);
    expect(rails[0].label).toBe("Bugs");
  });
  it("breaks priority ties by people count", () => {
    const rails = groupRails([mk({ id: "few", people_count: 1 }), mk({ id: "many", people_count: 4 })]);
    expect(rails[0].items.map((i) => i.id)).toEqual(["many", "few"]);
  });
  it("puts urgency 9 and up in an Urgent rail first, most urgent first by the unrounded value, and only there", () => {
    const rails = groupRails([
      mk({ id: "b8", urgency: 8, urgency_raw: 8.2 }), mk({ id: "b10", urgency: 10, urgency_raw: 9.6 }), mk({ id: "a10", type: "add_on", urgency: 10, urgency_raw: 9.7 }),
      mk({ id: "b9", urgency: 9, urgency_raw: 9.2, importance: 40 }), mk({ id: "b9low", urgency: 9, urgency_raw: 8.6, importance: 95 }),
    ]);
    expect(rails.map((r) => r.type)).toEqual(["urgent", "bug", "new_feature", "add_on", "streamline"]);
    expect(rails[0].label).toBe("Urgent");
    expect(rails[0].items.map((i) => i.id)).toEqual(["a10", "b10", "b9", "b9low"]);
    expect(rails[1].items.map((i) => i.id)).toEqual(["b8"]);
    expect(rails[3].items).toEqual([]);
  });
  it("leaves the urgent rail out when nothing is urgent, and keeps shipped work in its type rail", () => {
    const rails = groupRails([mk({ id: "s", urgency: 10, status: "shipped", draft: draft("ready") }), mk({ id: "n", urgency: null })]);
    expect(rails.map((r) => r.type)).toEqual(["bug", "new_feature", "add_on", "streamline"]);
    expect(rails[0].items.map((i) => i.id).sort()).toEqual(["n", "s"]);
  });
});

describe("dominantEmotion", () => {
  it("picks the most common emotion", () => expect(dominantEmotion(["confused", "frustrated", "confused"], -1)).toBe("confused"));
  it("breaks ties toward the more negative emotion", () => expect(dominantEmotion(["pleased", "frustrated"], 0)).toBe("frustrated"));
  it("falls back to mean sentiment when no emotion is labelled", () => {
    expect(dominantEmotion([null, null], -1.5)).toBe("frustrated");
    expect(dominantEmotion([], 1.2)).toBe("pleased");
    expect(dominantEmotion([null], 0)).toBe("neutral");
  });
  it("ignores unknown labels", () => expect(dominantEmotion(["angry", "pleased"], 0)).toBe("pleased"));
});

describe("proposalSlot", () => {
  it("says when there is no proposal yet", () => expect(proposalSlot(mk({ proposal: { count: 0, title: null } }))).toEqual({ stage: "needs_proposal", label: "No proposal yet", detail: null }));
  it("names the single proposal", () => expect(proposalSlot(base)).toEqual({ stage: "proposal_ready", label: "Proposal ready", detail: "Explicit sent / failed states" }));
  it("counts several proposals and names the recommended one", () => expect(proposalSlot(mk({ proposal: { count: 3, title: "Class filter" } }))).toEqual({ stage: "proposal_ready", label: "3 proposals", detail: "Class filter" }));
  it("says an issue waits on its first step, in its own words", () => {
    expect(proposalSlot(mk({ diagnosis: null }))).toEqual({ stage: "needs_diagnosis", label: "Needs diagnosis", detail: "Next: Run diagnostics" });
    expect(proposalSlot(mk({ type: "new_feature", diagnosis: null }))).toEqual({ stage: "needs_diagnosis", label: "Needs scoping", detail: "Next: Scope it" });
  });
  it("names the drafted proposal while drafting", () => expect(proposalSlot(mk({ status: "drafting", draft: draft("dispatched", "Inline retry") }))).toEqual({ stage: "drafting", label: "Drafting", detail: "Inline retry" }));
});

describe("attention", () => {
  it("counts drafts ready for review and failed drafts", () => {
    expect(attention([mk({ status: "draft_ready", draft: draft("ready") }), mk({ status: "in_review", draft: draft("ready") }), mk({ draft: draft("failed") }), base])).toEqual({ review: 2, failed: 1 });
  });
});
