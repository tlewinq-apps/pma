// The first step every issue gets before anyone proposes anything, one per type: a bug runs diagnostics, a feature
// request is scoped, an add-on finds where it fits and a streamline issue has its steps mapped. Proposals are then
// written from what it found. All the per-type words live here, so the Slack card, its thread, the write form and
// the web workspace say the same thing. Pure; the run itself is in run.ts, the stored state in model.ts.
import type { IssueType } from "@/lib/types";
import type { CodeExcerpt } from "@/lib/repo/context";
import type { DiagnosisFinding, FindingSource } from "./model";

export type CheckCopy = {
  /** The button: "Run diagnostics". */
  button: string;
  /** Stage labels while it waits and while it runs: "Needs diagnosis", "Diagnosing". */
  waiting: string;
  running: string;
  /** The stepper's short name: "Diagnose". */
  step: string;
  /** "Thomas is running diagnostics." */
  verb: string;
  /** The activity log: "ran diagnostics on Messages". */
  started: string;
  /** The bold word that opens the result: "Cause found." */
  done: string;
  /** What the workspace calls the result, and where it came from: "Cause", "found by diagnostics". */
  result: string;
  resultFrom: string;
  /** The panel before a run: a heading and one line. */
  panelTitle: string;
  panelBody: string;
  /** The next-step sentence while it waits and while it runs. */
  next: string;
  nextRunning: string;
  /** The proposals message header after the count: "3 ways to fix it". */
  ways: string;
  /** The write-your-own form. writePlaceholder is the demo's Celeste example: read it through writePlaceholder(),
   *  which gives any other app an example that fits any product (the Slack modal that uses it is the demo's Slack). */
  writeTitle: string;
  writeLabel: string;
  writePlaceholder: string;
};

export const CHECKS: Record<IssueType, CheckCopy> = {
  bug: {
    button: "Run diagnostics", waiting: "Needs diagnosis", running: "Diagnosing", step: "Diagnose",
    verb: "is running diagnostics", started: "ran diagnostics", done: "Cause found.", result: "Cause", resultFrom: "found by diagnostics",
    panelTitle: "Diagnose first", panelBody: "Find out why it happens before anyone drafts a fix. Proposals are written from what the run finds.",
    next: "Run diagnostics to find out why it happens. Proposals for a fix follow on their own.",
    nextRunning: "Diagnostics are running. Proposals for a fix arrive when they finish.",
    ways: "fix it", writeTitle: "Write a fix", writeLabel: "How would you fix it?",
    writePlaceholder: "Say whether Restore purchase worked, with a Retry button when it didn't.",
  },
  new_feature: {
    button: "Scope it", waiting: "Needs scoping", running: "Scoping", step: "Scope",
    verb: "is scoping it", started: "started scoping", done: "Scoped.", result: "Smallest useful version", resultFrom: "from scoping it",
    panelTitle: "Scope it first", panelBody: "Find out who wants it, how they cope today and the smallest version worth building. Proposals are written from the scope.",
    next: "Scope it to see who wants it and the smallest useful version. Proposals follow on their own.",
    nextRunning: "Scoping. Proposals arrive when it finishes.",
    ways: "build it", writeTitle: "Write a proposal", writeLabel: "What would you build?",
    writePlaceholder: "A reminder on the evening of each full moon, set under Notifications.",
  },
  add_on: {
    button: "Find where it fits", waiting: "Needs a home", running: "Finding where it fits", step: "Find where it fits",
    verb: "is finding where it fits", started: "started finding where it fits", done: "Found where it fits.", result: "Where it fits", resultFrom: "from finding where it fits",
    panelTitle: "Find where it fits first", panelBody: "Find the screen it extends and what else it touches. Proposals are written from that.",
    next: "Find where it fits: the screen it extends and what it touches. Proposals follow on their own.",
    nextRunning: "Finding where it fits. Proposals arrive when it finishes.",
    ways: "add it", writeTitle: "Write a proposal", writeLabel: "What would you add, and where?",
    writePlaceholder: "Filter chips above past journal entries: New moon, Full moon, Eclipse.",
  },
  streamline: {
    button: "Map the steps", waiting: "Needs mapping", running: "Mapping the steps", step: "Map the steps",
    verb: "is mapping the steps", started: "started mapping the steps", done: "Steps mapped.", result: "What could go", resultFrom: "from mapping the steps",
    panelTitle: "Map the steps first", panelBody: "Count the steps people take today and find where they stall. Proposals are written from the map.",
    next: "Map the steps to see where people stall. Proposals follow on their own.",
    nextRunning: "Mapping the steps. Proposals arrive when it finishes.",
    ways: "simplify it", writeTitle: "Write a proposal", writeLabel: "How would you make it simpler?",
    writePlaceholder: "A Compare button on each friend's row, so it takes one tap.",
  },
};

const isType = (t: string): t is IssueType => t in CHECKS;
/** The copy for an issue's type; anything unexpected reads as a bug, the strictest flow. */
export const checkOf = (type: string): CheckCopy => CHECKS[isType(type) ? type : "bug"];

/** The refusal while proposals wait on the first step. */
export const checkFirst = (type: string) => `${checkOf(type).button} first. Proposals are written from what it finds.`;

/** The write-your-own placeholder: the demo's Celeste examples, or one that fits any app. */
const ANY_APP_PLACEHOLDER: Record<IssueType, string> = {
  bug: "Show a Retry button when the page can't load, instead of a blank screen.",
  new_feature: "Let people save a search and get a notification when something new matches it.",
  add_on: "An Edit button on a sent message, for the first 15 minutes.",
  streamline: "Put the two settings people look for under one heading.",
};
export const writePlaceholder = (type: string, demo: boolean) => (demo ? checkOf(type).writePlaceholder : ANY_APP_PLACEHOLDER[isType(type) ? type : "bug"]);

/** The demo's simulated run, in order, named after the issue's screen and the person who raised it. Demo only: a
 *  customer app's run shows PLANNED_CODE_STEPS or PLANNED_FEEDBACK_STEPS. */
export function checkSteps(type: string, screen: string | null, reporter: string | null): string[] {
  const where = screen ?? "the affected screen";
  switch (isType(type) ? type : "bug") {
    case "new_feature": return [
      reporter ? `Gather every request for this, starting with ${reporter}'s` : "Gather every request for this",
      "Note how members manage without it today",
      `Check what ${where} already does`,
      "Write up the smallest useful version",
    ];
    case "add_on": return [
      `Find the screen it belongs on, starting from ${where}`,
      `List what ${where} shows today`,
      "Check what else the change would touch",
      "Write up where it fits",
    ];
    case "streamline": return [
      `Walk through ${where} step by step`,
      "Count the taps and screens it takes today",
      reporter ? `Mark where ${reporter} got stuck` : "Mark where people get stuck",
      "Write up what could go",
    ];
    default: return [
      `Trace ${where} to its code and the request behind it`,
      `Add logging around ${where}: status, timing and app version`,
      reporter ? `Replay ${reporter}'s report against recent sessions` : "Replay the reports against recent sessions",
      "Write up the cause",
    ];
  }
}

// A customer app's run is real, so it can't tick through steps on a timer: these are the plan while it runs, and
// codeRunSteps or feedbackRunSteps replace them with what it did once the finding is saved.
/** The plan for an app with a repository. */
export const PLANNED_CODE_STEPS = ["Read the feedback", "Search the code", "Read the files that matter", "Write the finding"];
/** The plan for an app without one. */
export const PLANNED_FEEDBACK_STEPS = ["Read the feedback", "Write the finding from the feedback"];

const count = (n: number) => n.toLocaleString("en-US");
/** "Searched 1,234 files for "a", "b"", and the line saying a big repository was only partly searched. */
function searchLines(c: { searched: number; terms: string[]; partial?: boolean }): string[] {
  const shown = c.terms.slice(0, 4).map((t) => `"${t}"`).join(", ");
  const more = c.terms.length > 4 ? ` and ${c.terms.length - 4} more` : "";
  return [
    ...(c.terms.length ? [`Searched ${count(c.searched)} files for ${shown}${more}`] : []),
    ...(c.partial ? [`Searched the first ${count(c.searched)} files (the repository is large)`] : []),
  ];
}

type Read = Pick<CodeExcerpt, "path" | "from" | "to">;
const readLine = (e: Read) => `Read ${e.path} (lines ${e.from}–${e.to})`;

/** The step when a run that read code still has no exact lines after looking again. */
export const RAN_OUT = "Ran out of looks before finding the exact lines";

/** What a run that read code did: the search, the first four excerpts it read, each time it looked again (what for,
 *  then what it read), whether it ran out of looks, the finding. */
export function codeRunSteps(c: { searched: number; terms: string[]; excerpts: Read[]; partial?: boolean }, rounds: { what: string; read: Read[] }[] = [], ranOut = false): string[] {
  return [
    "Read the feedback", ...searchLines(c),
    ...c.excerpts.slice(0, 4).map(readLine),
    ...rounds.flatMap((r) => [`Looked again for ${r.what}`, ...r.read.slice(0, 4).map(readLine)]),
    ...(ranOut ? [RAN_OUT] : []),
    "Wrote the finding",
  ];
}

/** What a feedback-only run did: with no repository, with one it couldn't open, or after a search that found nothing. */
export function feedbackRunSteps(w: { unreadable?: string; searched?: number; terms?: string[]; partial?: boolean }): string[] {
  return [
    "Read the feedback",
    ...(w.unreadable ? [`Couldn't read ${w.unreadable}`] : []),
    ...(w.searched !== undefined ? [...searchLines({ searched: w.searched, terms: w.terms ?? [], partial: w.partial }), "Found no code that matches the feedback"] : []),
    "Wrote the finding from the feedback",
  ];
}

/** Under a customer app's finding when no repository is connected, and under its first step before it runs. */
export const FEEDBACK_ONLY = "Based on the feedback only. Connect your repository so this step reads your code.";
export const FEEDBACK_ONLY_AHEAD = "This step will use the feedback only. Connect your repository so it reads your code.";
/** Where a customer app's finding came from, in one line. A finding that read code but names no lines (`refs` empty)
 *  says the exact lines weren't found, rather than reading as a confirmed find. A repository name can end in "."
 *  (acme/Closet.), so it always sits mid-sentence, never right before a full stop or a semicolon. */
export function sourceLine(s: FindingSource, refs?: readonly unknown[]): string {
  if (s.read) return refs && refs.length === 0 ? `PMA read ${s.repo} but couldn't find the exact lines.` : `Read from ${s.repo} at ${s.ref}.`;
  return s.repo ? `Based on the feedback only. PMA looked in ${s.repo} but couldn't find the code for it.` : FEEDBACK_ONLY;
}

/** The first sentence of a longer text, for fallback findings. */
const firstSentence = (s: string | null | undefined) => (s ?? "").trim().split(/(?<=[.!?])\s+/)[0] ?? "";

/** Without a model key, the demo's finding is written from what the rating and the problem statement already say.
 *  Demo only: a customer app without a key fails its run with a plain sentence instead (run.ts). */
export function fallbackFinding(type: string, i: { title: string; problem?: string | null; suspected_cause?: string | null; screen: string | null; reporter?: string | null }): DiagnosisFinding {
  const where = i.screen ?? "the affected screen";
  const problem = firstSentence(i.problem) || `${i.title}.`;
  const base = { logging_added: [] as string[], where, confidence: "likely" as const };
  switch (isType(type) ? type : "bug") {
    case "new_feature": return {
      ...base, headline: `The smallest useful version adds this to ${where}, without a new flow.`,
      facts: [{ label: "Who wants it", text: `${i.reporter ?? "Members"} and others who raised it.` }, { label: "How they cope today", text: problem }],
      evidence: [problem],
    };
    case "add_on": return {
      ...base, headline: `It fits on ${where}, next to what's already there.`,
      facts: [{ label: "There today", text: problem }, { label: "It touches", text: `Only ${where}, so nothing else changes.` }],
      evidence: [problem],
    };
    case "streamline": return {
      ...base, headline: `${where} asks for a step it doesn't need; taking it out is the fix.`,
      facts: [{ label: "Steps today", text: problem }, { label: "Where people stall", text: `The point on ${where} where the next step isn't clear.` }],
      evidence: [problem],
    };
    default: {
      const cause = i.suspected_cause?.trim() || `${i.title}: the request behind ${where} fails, and the screen shows nothing instead of an error.`;
      return {
        ...base, headline: cause, cause, facts: [],
        evidence: [`Failed loads on ${where} cluster around the same request in recent sessions.`, "The screen has no error state, so a failure looks like an empty page."],
        logging_added: [`A log line for every failed request on ${where}, with status, timing and app version.`],
      };
    }
  }
}

/** At most two short lines under the result headline: a bug's evidence, the other types' facts. */
export function resultLines(f: Pick<DiagnosisFinding, "facts" | "evidence">): string[] {
  return f.facts.length ? f.facts.slice(0, 2).map((x) => `${x.label}: ${x.text}`) : f.evidence.slice(0, 2);
}
