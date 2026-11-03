// The one thing a PM should do next on an issue, in a sentence. Pure; shown under the stage stepper.
import { BUILD_FAILED, BUILDING } from "@/lib/handoff/build";
import type { Stage } from "@/components/triage/views";
import { checkOf } from "@/lib/diagnosis/checks";
import { CONNECT_REPO_TO_DRAW } from "@/lib/drafts/codeMockup";

export type NextStepInput = {
  stage: Stage;
  /** The issue type, which names its first step; bug wording when missing. */
  type?: string;
  /** Follow-up questions are drafted and nobody has been asked yet. */
  unaskedQuestions: boolean;
  slackReporters: number;
  /** The recommended (or first) proposal names the screens it changes, so Implement can draft it. */
  recommendedHasScreens: boolean;
  /** People who raised it outside Slack, who only hear back if someone sends them a note. */
  othersToTell: number;
  backend: string;
  /** Proposals are being written (asked for, or right after a diagnosis). */
  writingProposals?: boolean;
  /** A customer app with a repository: a proposal with no screens is mocked up from its code (drafts/codeMockup.ts). */
  drawsFromCode?: boolean;
  /** A customer app without a repository, so a proposal with no screens can't be mocked up. */
  needsRepo?: boolean;
  /** The draft in flight is an approximate mock-up drawn from the code. */
  approximate?: boolean;
  /** Ready to build: what's next for the approved mock-up (lib/handoff/build.ts buildProgress), and whether the reader
   *  may mark it shipped (owners and admins). */
  build?: { next: "hand_off" | "link_pr" | "building" | "build_failed" | "ship" | "done"; mayShip: boolean };
};

/**
 * A customer app's approved mock-up: build it, then link the pull request (its merge ships the issue). The workspace
 * turns `action` into a pointer at the Copy task button. Nobody who raised it is told anything yet.
 */
export const READY_TO_BUILD = { lead: "Ready to build. ", action: "Copy the task for Claude Code", tail: " and link the pull request." } as const;
export const WAITING_FOR_PR = "Waiting for the pull request. Link it here once your engineers open it.";
export const PR_LINKED_SHIP = "Pull request linked. Mark it shipped once it merges, and PMA tells the people who raised it.";
export const PR_LINKED_WAIT = "Pull request linked. An owner or admin marks it shipped once it merges.";

export function nextStep(n: NextStepInput): string {
  switch (n.stage) {
    case "ready_to_build":
      if (n.build?.next === "ship") return n.build.mayShip ? PR_LINKED_SHIP : PR_LINKED_WAIT;
      if (n.build?.next === "link_pr") return WAITING_FOR_PR;
      if (n.build?.next === "building") return BUILDING;
      if (n.build?.next === "build_failed") return BUILD_FAILED;
      return `${READY_TO_BUILD.lead}${READY_TO_BUILD.action}${READY_TO_BUILD.tail}`;
    case "shipped":
      return n.othersToTell
        ? `Shipped. Let the ${n.othersToTell} ${n.othersToTell === 1 ? "person" : "people"} who raised it outside Slack know: copy a note from People who raised this.`
        : "Shipped. Everyone who raised it on Slack has been told.";
    case "dismissed": return "Dismissed. Nothing to do.";
    case "review": case "in_review":
      // An approximate mock-up is approved, not shipped: approving it makes the issue Ready to build.
      return n.approximate ? "Review the mock-up: approve it, or ask for changes." : "Review the mockup: approve and ship it, or ask for changes.";
    case "drafting":
      if (n.approximate) return "An approximate mock-up is being drawn from your code. It shows up here in a minute or two.";
      return n.backend === "github" ? "A mockup is being drafted in Marver. It shows up here in a few minutes." : "A mockup is being drafted. It shows up here in a few seconds.";
    case "failed": return "The mockup didn't finish. Retry it, or edit the proposal and mock it up again.";
    case "needs_diagnosis": return checkOf(n.type ?? "bug").next;
    case "diagnosing": return checkOf(n.type ?? "bug").nextRunning;
  }
  if (n.writingProposals && n.stage === "needs_proposal") return "Proposals are being written. They show up here in a moment.";
  if (n.unaskedQuestions) {
    return n.slackReporters
      ? "It's too vague to act on yet. Ask the people who raised it the questions on the right."
      : "It's too vague to act on yet. Copy the questions on the right and send them to the people who raised it.";
  }
  if (n.stage === "needs_proposal") return "Ask PMA to write proposals, or write your own.";
  if (n.recommendedHasScreens || n.drawsFromCode) return "Pick a proposal (the recommended one is first) and mock it up, or write your own.";
  return n.needsRepo ? CONNECT_REPO_TO_DRAW : "This issue isn't matched to a screen yet, so it can't be mocked up. The proposals still say what to change.";
}
