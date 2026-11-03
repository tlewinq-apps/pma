import { describe, it, expect } from "vitest";
import { nextTourState, stageStep, startTour, tourCard, TOUR_LENGTH, type TourInput, type TourState } from "@/lib/tour/steps";

const issue = { id: "i1", title: "Class messages fail to load", type: "bug" as const };
const at = (step: number, over: Partial<TourState> = {}): TourState => ({ ...startTour(issue), step, ...over });
const base = "/demo/celeste";
// `path` is where the reader is inside the app (Tour strips the base); links the card offers carry the base.
const input = (over: Partial<TourInput>): TourInput => ({ state: at(1), base, path: "/welcome", stage: null, slackJoined: null, hasInvite: true, email: "pat@example.com", ...over });
const onIssue = "/issues/i1";

describe("tour card", () => {
  it("shows nothing without an active tour", () => {
    expect(tourCard(input({ state: null }))).toBeNull();
    expect(tourCard(input({ state: at(3, { status: "done" }) }))).toBeNull();
    expect(tourCard(input({ state: at(3, { status: "skipped" }) }))).toBeNull();
  });

  it("opens on the issue it will walk through, wherever the reader is", () => {
    const c = tourCard(input({}))!;
    expect(c.step).toBe(1);
    expect(c.body).toContain("Class messages fail to load");
    expect(c.primary).toEqual({ label: "Start", action: "next" });
    expect(c.targets).toEqual([]);
    expect(TOUR_LENGTH).toBe(8);
  });

  it("asks them to join Slack with their sign-in email, and moves on by itself once they have", () => {
    const c = tourCard(input({ state: at(2) }))!;
    expect(c.step).toBe(2);
    expect(c.body).toContain("pat@example.com");
    expect(c.targets[0]).toBe('[data-tour="join-slack"]');
    expect(c.primary).toEqual({ label: "Skip for now", action: "next" });
    expect(c.back).toBe(true);
    expect(tourCard(input({ state: at(2), slackJoined: true }))!.step).toBe(3);
    expect(tourCard(input({ state: at(2), hasInvite: false }))!.step).toBe(3);
  });

  it("points at the issue's card on the Desk, and sends them there from anywhere else", () => {
    const desk = tourCard(input({ state: at(3), path: "/" }))!;
    expect(desk.targets).toEqual(['[data-card-id="i1"]']);
    expect(desk.primary).toBeNull();
    const elsewhere = tourCard(input({ state: at(3), path: "/welcome" }))!;
    expect(elsewhere.primary).toEqual({ label: "Go to the Desk", href: "/demo/celeste?focus=i1" });
  });

  it("introduces the issue page once they open it, before any action", () => {
    for (const stage of ["needs_diagnosis", "review", "shipped"] as const) {
      const c = tourCard(input({ state: at(3), path: onIssue, stage }))!;
      expect(c.step).toBe(4);
      expect(c.targets).toEqual(['[data-tour="evidence"]']);
      expect(c.primary).toEqual({ label: "Next", action: "next" });
    }
  });

  it("says who gives feedback in the app's own words, and plain words by default", () => {
    const shoppers = { one: "shopper", many: "shoppers" };
    expect(tourCard(input({ audience: shoppers }))!.body).toContain("from what a shopper said to a shipped fix");
    expect(tourCard(input({ audience: { one: "engineer", many: "engineers" } }))!.body).toContain("from what an engineer said");
    expect(tourCard(input({ state: at(3), path: "/", audience: shoppers }))!.body).toMatch(/^Everything shoppers raised/);
    expect(tourCard(input({ state: at(3), path: onIssue, stage: "needs_diagnosis", audience: shoppers }))!.title).toBe("What shoppers said");
    for (const c of [tourCard(input({}))!, tourCard(input({ state: at(3), path: "/" }))!, tourCard(input({ state: at(3), path: onIssue, stage: "review" }))!]) {
      expect(`${c.title} ${c.body}`).toMatch(/person|people/);
    }
    expect(tourCard(input({ state: at(3), path: onIssue, stage: "review" }))!.title).toBe("What people said");
  });

  it("waits for the page to say where the issue stands", () => {
    expect(tourCard(input({ state: at(5), path: onIssue, stage: null }))).toBeNull();
  });

  it("follows the issue's stage from the first step to shipped, in each type's own words", () => {
    const card = (stage: TourInput["stage"], type: TourState["type"] = "bug") => tourCard(input({ state: at(5, { type }), path: onIssue, stage }))!;
    expect(card("needs_diagnosis")).toMatchObject({ step: 5, kind: "do", title: "Run diagnostics", targets: ['[data-tour="first-step"]'] });
    expect(card("needs_diagnosis", "new_feature")).toMatchObject({ step: 5, title: "Scope it" });
    expect(card("diagnosing")).toMatchObject({ step: 5, kind: "wait", title: "Diagnosing" });
    expect(card("writing")).toMatchObject({ step: 5, kind: "wait", title: "Writing proposals" });
    expect(card("needs_proposal")).toMatchObject({ step: 6, kind: "do", targets: ['[data-tour="write-proposals"]'] });
    expect(card("proposal_ready")).toMatchObject({ step: 6, kind: "do", targets: ['[data-tour="mock-it-up"]'] });
    expect(card("failed")).toMatchObject({ step: 6, kind: "do", targets: ['[data-tour="retry-draft"]'] });
    expect(card("drafting")).toMatchObject({ step: 6, kind: "wait" });
    expect(card("review")).toMatchObject({ step: 7, kind: "do", targets: ['[data-tour="approve"]'] });
    expect(card("in_review")).toMatchObject({ step: 7 });
    expect(card("shipped")).toMatchObject({ step: 8, targets: ['[data-tour="open-in-slack"]'], primary: { label: "Finish", action: "finish" } });
    expect(card("dismissed")).toMatchObject({ step: 8, primary: { label: "Finish", action: "finish" } });
  });

  it("goes back a step when changes are requested, because the stage is the truth", () => {
    expect(tourCard(input({ state: at(7), path: onIssue, stage: "drafting" }))!.step).toBe(6);
  });

  it("pauses off the issue and offers the way back", () => {
    for (const path of ["/", "/work", "/issues/other"]) {
      const c = tourCard(input({ state: at(6), path, stage: "proposal_ready" }))!;
      expect(c).toMatchObject({ step: 6, kind: "away", title: "Tour paused", targets: [] });
      expect(c.primary).toEqual({ label: "Back to the issue", href: "/demo/celeste/issues/i1" });
    }
  });

  it("never uses all-caps labels, middle dots or arrows", () => {
    const cards = [
      tourCard(input({})), tourCard(input({ state: at(2) })), tourCard(input({ state: at(3), path: "/" })),
      ...(["needs_diagnosis", "diagnosing", "writing", "needs_proposal", "proposal_ready", "failed", "drafting", "review", "shipped", "dismissed"] as const)
        .map((stage) => tourCard(input({ state: at(5), path: onIssue, stage }))),
    ];
    // PMA is the product's name, not an all-caps label.
    for (const c of cards) expect(`${c!.title} ${c!.body}`).not.toMatch(/·|→|\b(?!PMA\b)[A-Z]{3,}\b/);
  });
});

describe("tour state", () => {
  const ctx = { hasInvite: true, slackJoined: false };
  it("starts at the welcome step for the given issue", () => {
    expect(startTour(issue)).toEqual({ v: 1, issueId: "i1", title: "Class messages fail to load", type: "bug", step: 1, status: "active" });
  });
  it("skips Slack when there's no invite or they're already in", () => {
    expect(nextTourState(at(1), "next", ctx).step).toBe(2);
    expect(nextTourState(at(1), "next", { hasInvite: false, slackJoined: null }).step).toBe(3);
    expect(nextTourState(at(1), "next", { hasInvite: true, slackJoined: true }).step).toBe(3);
    expect(nextTourState(at(3), "back", { hasInvite: true, slackJoined: true }).step).toBe(1);
    expect(nextTourState(at(3), "back", ctx).step).toBe(2);
  });
  it("finishes or skips for good", () => {
    expect(nextTourState(at(4), "next", ctx).step).toBe(5);
    expect(nextTourState(at(8), "finish", ctx).status).toBe("done");
    expect(nextTourState(at(5), "skip", ctx).status).toBe("skipped");
  });
  it("maps every stage to the step that acts on it", () => {
    expect([stageStep("needs_diagnosis"), stageStep("proposal_ready"), stageStep("review"), stageStep("shipped")]).toEqual([5, 6, 7, 8]);
  });
});
