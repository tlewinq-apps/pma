import { describe, it, expect } from "vitest";
import { nextStep } from "@/lib/nextStep";

const base = { stage: "proposal_ready" as const, unaskedQuestions: false, slackReporters: 0, recommendedHasScreens: true, othersToTell: 0, backend: "mock" };

describe("nextStep", () => {
  it("tells a new PM the one thing to do now, at every stage", () => {
    expect(nextStep({ ...base, stage: "needs_proposal" })).toBe("Ask PMA to write proposals, or write your own.");
    expect(nextStep(base)).toBe("Pick a proposal (the recommended one is first) and mock it up, or write your own.");
    expect(nextStep({ ...base, recommendedHasScreens: false })).toBe("This issue isn't matched to a screen yet, so it can't be mocked up. The proposals still say what to change.");
    expect(nextStep({ ...base, stage: "drafting" })).toBe("A mockup is being drafted. It shows up here in a few seconds.");
    expect(nextStep({ ...base, stage: "drafting", backend: "github" })).toBe("A mockup is being drafted in Marver. It shows up here in a few minutes.");
    expect(nextStep({ ...base, stage: "failed" })).toBe("The mockup didn't finish. Retry it, or edit the proposal and mock it up again.");
    expect(nextStep({ ...base, stage: "review" })).toBe("Review the mockup: approve and ship it, or ask for changes.");
    expect(nextStep({ ...base, stage: "in_review" })).toBe("Review the mockup: approve and ship it, or ask for changes.");
    expect(nextStep({ ...base, stage: "dismissed" })).toBe("Dismissed. Nothing to do.");
  });

  it("diagnoses a bug before any fix, then says proposals are on their way", () => {
    expect(nextStep({ ...base, stage: "needs_diagnosis" })).toBe("Run diagnostics to find out why it happens. Proposals for a fix follow on their own.");
    expect(nextStep({ ...base, stage: "diagnosing", unaskedQuestions: true })).toBe("Diagnostics are running. Proposals for a fix arrive when they finish.");
    expect(nextStep({ ...base, stage: "needs_proposal", writingProposals: true })).toBe("Proposals are being written. They show up here in a moment.");
  });

  it("names each type's own first step", () => {
    expect(nextStep({ ...base, stage: "needs_diagnosis", type: "new_feature" })).toBe("Scope it to see who wants it and the smallest useful version. Proposals follow on their own.");
    expect(nextStep({ ...base, stage: "needs_diagnosis", type: "add_on" })).toBe("Find where it fits: the screen it extends and what it touches. Proposals follow on their own.");
    expect(nextStep({ ...base, stage: "diagnosing", type: "streamline" })).toBe("Mapping the steps. Proposals arrive when it finishes.");
  });

  it("puts vague feedback first: ask before building", () => {
    expect(nextStep({ ...base, unaskedQuestions: true, slackReporters: 2 })).toBe("It's too vague to act on yet. Ask the people who raised it the questions on the right.");
    expect(nextStep({ ...base, stage: "needs_proposal", unaskedQuestions: true })).toBe("It's too vague to act on yet. Copy the questions on the right and send them to the people who raised it.");
  });

  it("closes the loop once shipped", () => {
    expect(nextStep({ ...base, stage: "shipped" })).toBe("Shipped. Everyone who raised it on Slack has been told.");
    expect(nextStep({ ...base, stage: "shipped", othersToTell: 2 })).toBe("Shipped. Let the 2 people who raised it outside Slack know: copy a note from People who raised this.");
    expect(nextStep({ ...base, stage: "shipped", othersToTell: 1 })).toBe("Shipped. Let the 1 person who raised it outside Slack know: copy a note from People who raised this.");
  });
});
