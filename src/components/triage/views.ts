// Pure hub logic shared by the hub, the cards and the workspace. No server imports.
import type { IssueCardData } from "@/lib/queries/issues";
import type { IssueType, Lane } from "@/lib/types";
import { EMOTIONS, RAIL_LABEL, RAIL_ORDER, sceneOf, type Emotion } from "./format";
import { diagnosisState, type Diagnosis } from "@/lib/diagnosis/model";
import { checkOf } from "@/lib/diagnosis/checks";

/**
 * Where an issue sits on the way from feedback to shipped design. One function so the card, views and stepper agree.
 * `ready_to_build` is a customer app's approved mock-up: it ships only when a linked code pull request merges.
 */
export type Stage = "needs_diagnosis" | "diagnosing" | "needs_proposal" | "proposal_ready" | "failed" | "drafting" | "review" | "in_review" | "ready_to_build" | "shipped" | "dismissed";

/**
 * `staleDraft`: the draft in flight can no longer finish (an approximate mock-up whose run was killed, drafts/codeMockup.ts
 * isStaleMockup), so it reads as failed and offers Retry instead of drawing forever.
 */
export function stageOf(i: { status: IssueCardData["status"]; draft: { status: string } | null; proposal: { count: number }; type?: string; diagnosis?: Diagnosis | null; staleDraft?: boolean }, now?: number): Stage {
  switch (i.status) {
    case "shipped": return "shipped";
    case "dismissed": return "dismissed";
    case "ready_to_build": return "ready_to_build";
    case "drafting": return i.staleDraft ? "failed" : "drafting";
  }
  // A failed latest draft wins over a review status left behind by a failed re-draft: there is nothing to approve.
  if (i.draft?.status === "failed") return "failed";
  if (i.status === "in_review") return "in_review";
  if (i.status === "draft_ready") return "review";
  // Every issue gets its first step before anything is proposed (lib/diagnosis). Checked after the draft states, so nothing goes backwards.
  const diag = i.type ? diagnosisState(i.type, i.diagnosis, now) : null;
  if (diag === "needed") return "needs_diagnosis";
  if (diag === "running") return "diagnosing";
  return i.proposal.count > 0 ? "proposal_ready" : "needs_proposal";
}

export const STAGE_LABEL: Record<Stage, string> = {
  needs_diagnosis: "Needs diagnosis", diagnosing: "Diagnosing", needs_proposal: "No proposal yet", proposal_ready: "Proposal ready",
  failed: "Draft failed", drafting: "Drafting", review: "Ready for review", in_review: "In review", ready_to_build: "Ready to build", shipped: "Shipped", dismissed: "Dismissed",
};

/** The stage in the issue's own words: the first-step stages say "Needs scoping" on a feature, "Mapping the steps" on a streamline issue. */
export function stageLabel(stage: Stage, type: string | null | undefined): string {
  if (type && stage === "needs_diagnosis") return checkOf(type).waiting;
  if (type && stage === "diagnosing") return checkOf(type).running;
  return STAGE_LABEL[stage];
}

/** Dot colour per stage (CSS vars from globals.css); null = no dot. */
export const STAGE_COLOR: Record<Stage, string | null> = {
  needs_diagnosis: "var(--stage-diagnose)", diagnosing: "var(--stage-diagnose)", needs_proposal: null, proposal_ready: "var(--stage-ready)",
  failed: "var(--stage-failed)", drafting: "var(--stage-drafting)", review: "var(--stage-review)", in_review: "var(--stage-review)", ready_to_build: "var(--stage-ready)", shipped: "var(--stage-shipped)", dismissed: null,
};

export function proposalSlot(i: IssueCardData): { stage: Stage; label: string; detail: string | null } {
  const stage = stageOf(i);
  if (stage === "needs_proposal") return { stage, label: STAGE_LABEL[stage], detail: null };
  if (stage === "needs_diagnosis") return { stage, label: stageLabel(stage, i.type), detail: `Next: ${checkOf(i.type).button}` };
  if (stage === "diagnosing") return { stage, label: stageLabel(stage, i.type), detail: null };
  if (stage === "proposal_ready") return { stage, label: i.proposal.count > 1 ? `${i.proposal.count} proposals` : STAGE_LABEL[stage], detail: i.proposal.title };
  return { stage, label: STAGE_LABEL[stage], detail: i.draft?.solution_title ?? i.proposal.title };
}

const STAGE_VIEWS = ["needs_diagnosis", "needs_proposal", "ready_to_implement", "drafting", "review", "shipped"] as const;
/** Listed only when an issue is in it: only a customer app's approved mock-ups get there, so the demo's list is unchanged. */
const READY_TO_BUILD_VIEW = "ready_to_build" as const;
const LANE_VIEWS = ["quick_win", "watch"] as const satisfies readonly Lane[];
const PEOPLE_VIEWS = ["mine", "unassigned"] as const;
type FixedView = "all" | (typeof STAGE_VIEWS)[number] | typeof READY_TO_BUILD_VIEW | (typeof LANE_VIEWS)[number] | (typeof PEOPLE_VIEWS)[number];
export type ViewId = FixedView | `flow:${string}`;
const FIXED = new Set<string>(["all", ...STAGE_VIEWS, READY_TO_BUILD_VIEW, ...LANE_VIEWS, ...PEOPLE_VIEWS]);

const VIEW_LABEL: Record<FixedView, string> = {
  all: "All", needs_diagnosis: "Needs a first step", needs_proposal: "Needs a proposal", ready_to_implement: "Ready to mock up", drafting: "Drafting",
  review: "Ready for review", ready_to_build: "Ready to build", shipped: "Shipped", quick_win: "Quick wins", watch: "Rising", mine: "Mine", unassigned: "Unassigned",
};
const VIEW_HINT: Partial<Record<FixedView, string>> = {
  needs_diagnosis: "Waiting on diagnostics, scoping, a home or a step map", quick_win: "High impact, small effort", watch: "Gaining reports",
};

export function parseView(v: string | null | undefined): ViewId {
  if (!v) return "all";
  if (FIXED.has(v)) return v as FixedView;
  return /^flow:[\w-]+$/.test(v) ? (v as ViewId) : "all";
}
export function viewLabel(v: ViewId): string {
  if (v.startsWith("flow:")) { const s = v.slice(5); return s.charAt(0).toUpperCase() + s.slice(1); }
  return VIEW_LABEL[v as FixedView];
}
export const viewHint = (v: ViewId) => VIEW_HINT[v as FixedView] ?? null;

export function viewMatches(v: ViewId, i: IssueCardData, me: string | null): boolean {
  const s = stageOf(i);
  if (s === "dismissed") return false;
  if (v === "shipped") return s === "shipped";
  if (s === "shipped") return false;
  switch (v) {
    case "all": return true;
    case "needs_diagnosis": return s === "needs_diagnosis" || s === "diagnosing";
    case "needs_proposal": return s === "needs_proposal";
    case "ready_to_implement": return s === "proposal_ready" || s === "failed";
    case "drafting": return s === "drafting";
    case "review": return s === "review" || s === "in_review";
    case "ready_to_build": return s === "ready_to_build";
    case "mine": return me !== null && i.owner?.email === me;
    case "unassigned": return i.owner === null;
  }
  if (v.startsWith("flow:")) return sceneOf(i.flow) === v.slice(5);
  return i.lane === v;
}

export function viewGroups(list: IssueCardData[]): { label: string; views: ViewId[] }[] {
  const scenes = [...new Set(list.map((i) => sceneOf(i.flow)).filter((s): s is string => !!s))].sort();
  return [
    { label: "Stage", views: list.some((i) => stageOf(i) === "ready_to_build") ? [...STAGE_VIEWS.slice(0, -1), READY_TO_BUILD_VIEW, "shipped"] : [...STAGE_VIEWS] },
    { label: "Signals", views: [...LANE_VIEWS] },
    { label: "People", views: [...PEOPLE_VIEWS] },
    { label: "Flow", views: scenes.map((s) => `flow:${s}` as ViewId) },
  ];
}

/** "urgent" is the top rail: the most pressing issues, whatever their type. */
export type RailKey = IssueType | "urgent";
export type Rail = { type: RailKey; label: string; items: IssueCardData[] };
export const URGENT_LABEL = "Urgent";
/**
 * Urgency (out of 10, lib/urgency) that puts an issue in the Urgent rail. Above Why it matters' "Act this week" line (8)
 * on purpose: a fresh blocker lands here straight away and leaves after about two quiet weeks, while a workaround,
 * however many report it, tops out at 8 and stands out by its badge.
 */
export const URGENT_FROM = 9;

/** Open and urgent enough for the top rail. Shipped work has been acted on. */
export const isUrgent = (i: IssueCardData) => (i.urgency ?? 0) >= URGENT_FROM && stageOf(i) !== "shipped";

/**
 * The urgent rail first (most urgent first), then one rail per type in fixed order (bugs first), each sorted by
 * priority, then by how many people reported it. An urgent issue sits only in the urgent rail, so no card shows twice.
 * The urgent rail is left out when nothing is urgent.
 */
export function groupRails(list: IssueCardData[]): Rail[] {
  const byPriority = (a: IssueCardData, b: IssueCardData) => (b.importance ?? -1) - (a.importance ?? -1) || b.people_count - a.people_count;
  const urgent = list.filter(isUrgent).sort((a, b) => (b.urgency_raw ?? 0) - (a.urgency_raw ?? 0) || byPriority(a, b));
  const rest = list.filter((i) => !isUrgent(i));
  return [
    ...(urgent.length ? [{ type: "urgent" as const, label: URGENT_LABEL, items: urgent }] : []),
    ...RAIL_ORDER.map((type) => ({ type, label: RAIL_LABEL[type], items: rest.filter((i) => i.type === type).sort(byPriority) })),
  ];
}

/** The most common labelled emotion; ties go to the more negative one. Without labels, falls back to mean sentiment. */
export function dominantEmotion(emotions: (string | null | undefined)[], meanSentiment: number): Emotion | null {
  const counts = new Map<Emotion, number>();
  for (const e of emotions) if (e && (EMOTIONS as readonly string[]).includes(e)) counts.set(e as Emotion, (counts.get(e as Emotion) ?? 0) + 1);
  if (counts.size) return EMOTIONS.reduce<Emotion | null>((best, e) => ((counts.get(e) ?? 0) > (best ? counts.get(best)! : 0) ? e : best), null);
  return meanSentiment <= -1 ? "frustrated" : meanSentiment >= 1 ? "pleased" : "neutral";
}

/** The issue a newcomer should try first: one still waiting on its first step, bugs first, then by priority. */
export function suggestFirstIssue(list: IssueCardData[]): IssueCardData | null {
  const waiting = list.filter((i) => stageOf(i) === "needs_diagnosis");
  const rank = (t: IssueType) => RAIL_ORDER.indexOf(t);
  return waiting.sort((a, b) => rank(a.type) - rank(b.type) || (b.importance ?? -1) - (a.importance ?? -1))[0] ?? null;
}

/** The issue the welcome tour walks through: one waiting on its first step if any, else the most urgent one still open. */
export function tourIssue(list: IssueCardData[]): IssueCardData | null {
  const first = suggestFirstIssue(list);
  if (first) return first;
  const open = list.filter((i) => { const s = stageOf(i); return s !== "shipped" && s !== "dismissed"; });
  const rank = (t: IssueType) => RAIL_ORDER.indexOf(t);
  return open.sort((a, b) => rank(a.type) - rank(b.type) || (b.importance ?? -1) - (a.importance ?? -1))[0] ?? null;
}

export function attention(list: IssueCardData[]): { review: number; failed: number } {
  let review = 0, failed = 0;
  for (const i of list) { const s = stageOf(i); if (s === "review" || s === "in_review") review++; else if (s === "failed") failed++; }
  return { review, failed };
}

export const matchesSearch = (i: IssueCardData, q: string) => {
  const t = q.trim().toLowerCase();
  return !t || i.title.toLowerCase().includes(t) || (i.flow ?? "").toLowerCase().includes(t) || (i.proposal.title ?? "").toLowerCase().includes(t);
};
