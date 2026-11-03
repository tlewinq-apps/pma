// The welcome tour: one real issue, walked from what someone said (a member, in the demo) to a shipped fix on the real screens. Pure, so the
// card (components/app/Tour.tsx) and its tests agree. The first four steps advance by hand (or by where the reader
// is); from the first step on, the issue's own stage says which step is showing, so the card moves on by itself when
// diagnostics, proposals or the mockup land, and picks up at the right place if someone else moved the issue along.
import type { IssueType } from "@/lib/types";
import type { Stage } from "@/components/triage/views";
import { checkOf } from "@/lib/diagnosis/checks";
import { appHref } from "@/lib/links";

export const TOUR_LENGTH = 8;
export type TourStatus = "active" | "done" | "skipped";
export type TourState = { v: 1; issueId: string; title: string; type: IssueType; step: number; status: TourStatus };
/** The tour issue's stage as its page shows it; "writing" while proposals are being written from its first step. */
export type TourStage = Stage | "writing";
export type TourAction = "next" | "back" | "skip" | "finish";
export type TourCard = {
  step: number;
  /** do: waiting on the reader. wait: PMA is working. away: off the tour's page. */
  kind: "do" | "wait" | "away";
  title: string;
  body: string;
  /** Selectors to outline, in order of preference; the first one on screen wins. */
  targets: string[];
  primary: { label: string; action: TourAction } | { label: string; href: string } | null;
  back: boolean;
};
export type TourInput = {
  state: TourState | null;
  /** The open app's base ("/demo/celeste"); the card's links go inside it. */
  base: string;
  /** Where the reader is inside the app, with the base taken off: "/" is the Desk, "/issues/<id>" an issue. */
  path: string;
  /** The tour issue's stage, read from its page; null anywhere else or while the page loads. */
  stage: TourStage | null;
  /** Whether Slack knows their email yet; null until checked. */
  slackJoined: boolean | null;
  hasInvite: boolean;
  email: string | null;
  /** Who gives the app feedback, as one and as many (the app's profile: "member" / "members" for the demo). */
  audience?: { one: string; many: string };
  /** The tour issue's mock-up is a customer app's approximate one, drawn from its code: approving it ships nothing. */
  approximate?: boolean;
};

const tour = (name: string) => `[data-tour="${name}"]`;
const card = (c: Omit<TourCard, "back"> & { back?: boolean }): TourCard => ({ back: false, ...c });

export const startTour = (issue: { id: string; title: string; type: IssueType }): TourState =>
  ({ v: 1, issueId: issue.id, title: issue.title, type: issue.type, step: 1, status: "active" });

/** The step that acts on an issue at this stage. */
export function stageStep(stage: TourStage): number {
  switch (stage) {
    case "needs_diagnosis": case "diagnosing": case "writing": return 5;
    case "needs_proposal": case "proposal_ready": case "failed": case "drafting": return 6;
    case "review": case "in_review": return 7;
    case "ready_to_build": case "shipped": case "dismissed": return 8;
  }
}

const needsSlack = (c: { hasInvite: boolean; slackJoined: boolean | null }) => c.hasInvite && c.slackJoined !== true;

export function nextTourState(s: TourState, action: TourAction, c: { hasInvite: boolean; slackJoined: boolean | null }): TourState {
  switch (action) {
    case "skip": return { ...s, status: "skipped" };
    case "finish": return { ...s, status: "done" };
    case "next": return { ...s, step: s.step === 1 && !needsSlack(c) ? 3 : Math.min(s.step + 1, TOUR_LENGTH) };
    case "back": return { ...s, step: s.step === 3 && !needsSlack(c) ? 1 : Math.max(s.step - 1, 1) };
  }
}

export function tourCard(i: TourInput): TourCard | null {
  const s = i.state;
  const { one, many } = i.audience ?? { one: "person", many: "people" };
  if (!s || s.status !== "active") return null;
  const issuePath = `/issues/${s.issueId}`;
  const issueHref = appHref(i.base, issuePath);
  const onIssue = i.path === issuePath;
  let step = s.step;
  if (step === 2 && !needsSlack(i)) step = 3;
  if (step === 3 && onIssue) step = 4;

  if (step === 1) return card({
    step, kind: "do", title: "A quick tour", targets: [],
    body: `We'll take one real issue, "${s.title}", from what ${/^[aeiou]/i.test(one) ? "an" : "a"} ${one} said to a shipped fix. You press the real buttons, and each step waits for you.`,
    primary: { label: "Start", action: "next" },
  });
  if (step === 2) return card({
    step, kind: "do", title: "Join the Slack workspace", targets: [tour("join-slack"), tour("join-slack-nav")], back: true,
    body: `Every issue also has a Slack thread, and its buttons work there too. Join with ${i.email ?? "the email you signed in with"} so your clicks count as you. This step ticks itself off once you're in.`,
    primary: { label: "Skip for now", action: "next" },
  });
  if (step === 3) return i.path === "/"
    ? card({
      step, kind: "do", title: "This is the Desk", targets: [`[data-card-id="${s.issueId}"]`], back: true, primary: null,
      body: `Everything ${many} raised, filed as bugs, new features, add-ons and things to streamline, most urgent first. Open the outlined issue.`,
    })
    : card({
      step, kind: "do", title: "Go to the Desk", targets: [], back: true,
      body: "Every issue lives there, sorted by type and how much it gets in the way.",
      primary: { label: "Go to the Desk", href: appHref(i.base, `/?focus=${s.issueId}`) },
    });

  if (!onIssue) return card({
    step, kind: "away", title: "Tour paused", targets: [],
    body: `Step ${step} of ${TOUR_LENGTH} is on "${s.title}".`,
    primary: { label: "Back to the issue", href: issueHref },
  });
  if (!i.stage) return null;
  if (step === 4) return card({
    step, kind: "do", title: `What ${many} said`, targets: [tour("evidence")],
    body: "On the left, their words: who said it, how many people, and how much it gets in the way. On the right, the work, one step at a time.",
    primary: { label: "Next", action: "next" },
  });

  const check = checkOf(s.type);
  step = stageStep(i.stage);
  switch (i.stage) {
    case "needs_diagnosis": return card({
      step, kind: "do", title: check.button, targets: [tour("first-step")], primary: null,
      body: `Every issue starts with one first step. ${check.panelBody} Press ${check.button} to start it.`,
    });
    case "diagnosing": return card({ step, kind: "wait", title: check.running, targets: [tour("first-step-progress")], primary: null, body: `${check.nextRunning} It takes about 15 seconds.` });
    case "writing": return card({ step, kind: "wait", title: "Writing proposals", targets: [tour("writing-proposals")], primary: null, body: "PMA is writing proposals from what it found. They show up here in a moment." });
    case "needs_proposal": return card({
      step, kind: "do", title: "Get proposals", targets: [tour("write-proposals")], primary: null,
      body: "Ask PMA to write proposals from what it found, or write your own in one box.",
    });
    case "proposal_ready": return card({
      step, kind: "do", title: "Pick a fix and mock it up", targets: [tour("mock-it-up")], primary: null,
      body: "PMA wrote these from what it found, and its pick is first. Open any of them to read it, then press Mock it up to see the change on the real screen.",
    });
    case "failed": return card({
      step, kind: "do", title: "The mockup didn't finish", targets: [tour("retry-draft")], primary: null,
      body: "Retry it, or pick another proposal and mock that one up.",
    });
    case "drafting": return card({
      step, kind: "wait", title: "Drawing the mockup", targets: [], primary: null,
      body: i.approximate
        ? "PMA is drawing your screen from its code, then the change over it. It can take a minute or two, and this card moves on when it's ready."
        : "PMA is changing the real Marver screen. It can take up to a minute, and this card moves on when it's ready.",
    });
    case "review": case "in_review": return i.approximate ? card({
      step, kind: "do", title: "Approve it, or ask for changes", targets: [tour("approve")], primary: null,
      body: "The changes are marked on PMA's drawing of your screen. Approve the mock-up to say this is the change to build, then choose how it gets built. Approving ships nothing, and nobody who raised it is told yet. Or Request changes with a note.",
    }) : card({
      step, kind: "do", title: "Approve it, or ask for changes", targets: [tour("approve")], primary: null,
      body: "The changes are outlined in orange on the real screen. Approve to ship it, or Request changes with a note. Create full flow draws the whole journey if you want to see more.",
    });
    // Only a customer app's approved mock-up gets here: it is built from the hand-off, and nobody is told until it ships.
    case "ready_to_build": return card({
      step, kind: "do", title: "Ready to build", targets: ["[data-handoff]", tour("build-track")],
      body: "The mock-up is approved. Copy or download the task for Claude Code to hand it to whoever builds it, then link the pull request here. It ships when that pull request merges. After that, Work shows what you own, and Start here brings this tour back.",
      primary: { label: "Finish", action: "finish" },
    });
    case "shipped": return card({
      step, kind: "do", title: "Shipped", targets: [tour("open-in-slack")],
      body: "Everyone who raised it on Slack was told in their own thread. Open the thread to see the whole story. After that, Work shows what you own, Flows shows each journey, and Start here brings this tour back.",
      primary: { label: "Finish", action: "finish" },
    });
    case "dismissed": return card({
      step, kind: "do", title: "This issue was dismissed", targets: [],
      body: "Start the tour again from Start here to walk through another one.",
      primary: { label: "Finish", action: "finish" },
    });
  }
}
