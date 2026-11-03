// Pure rules for PM-editable proposals: input validation, authorship labels, locks, and keeping PM work when
// PMA re-proposes. No server imports, so the workspace (client) and the routes share them.
import type { Stage } from "@/components/triage/views";
import { initials, peopleLabel } from "@/components/triage/format";
import { profileOf, type ProductProfile, type ProfileSource } from "@/lib/product/profile";
import { friendlyLlmError } from "@/lib/llm/errors";

export const EFFORTS = ["S", "M", "L"] as const;
export const RISKS = ["low", "medium", "high"] as const;
export type Effort = (typeof EFFORTS)[number];
export type Risk = (typeof RISKS)[number];
export type ProposalInput = { title: string; summary: string; tradeoffs: string | null; effort: Effort | null; risk: Risk | null; target_frames: string[] };

const LIMIT = { title: 80, summary: 1000, tradeoffs: 500 };
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Validates a proposal from the edit / write-your-own form. Screens must be frames of this project. */
export function parseProposalInput(body: unknown, projectFrames: readonly string[] | Set<string>): { value: ProposalInput } | { error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const title = str(b.title), summary = str(b.summary), tradeoffs = str(b.tradeoffs);
  if (!title) return { error: "Give the proposal a name" };
  if (title.length > LIMIT.title) return { error: `Keep the name under ${LIMIT.title} characters` };
  if (!summary) return { error: "Describe what changes" };
  if (summary.length > LIMIT.summary) return { error: `Keep the description under ${LIMIT.summary} characters` };
  if (tradeoffs.length > LIMIT.tradeoffs) return { error: `Keep the catch under ${LIMIT.tradeoffs} characters` };
  const effort = b.effort ?? null, risk = b.risk ?? null;
  if (effort !== null && !(EFFORTS as readonly unknown[]).includes(effort)) return { error: "Pick a size: Small, Medium, Large or Not sure" };
  if (risk !== null && !(RISKS as readonly unknown[]).includes(risk)) return { error: "Pick a risk: Low, Medium, High or Not sure" };
  const known = projectFrames instanceof Set ? projectFrames : new Set(projectFrames);
  const frames = b.target_frames ?? [];
  if (!Array.isArray(frames) || frames.some((f) => typeof f !== "string" || !known.has(f))) return { error: "Pick screens from the list" };
  return { value: { title, summary, tradeoffs: tradeoffs || null, effort: effort as Effort | null, risk: risk as Risk | null, target_frames: [...new Set(frames as string[])] } };
}

/** Write your own is one box: what the person would do, in their words. PMA names it (fallbackTitle now, the model a moment later). */
export function parseProposalText(body: unknown): { value: { text: string } } | { error: string } {
  const text = str((body && typeof body === "object" ? body as Record<string, unknown> : {}).text);
  if (!text) return { error: "Write what you would do" };
  if (text.length > LIMIT.summary) return { error: `Keep it under ${LIMIT.summary} characters` };
  return { value: { text } };
}

/** True when the body is the one-box form ({ text }), not the older title + summary form. */
export const isTextProposal = (body: unknown): boolean => !!body && typeof body === "object" && "text" in body && !("summary" in body);

/** A name to show until the model's is back: the first sentence, cut to 8 words, without a trailing full stop. */
export function fallbackTitle(text: string): string {
  const first = text.trim().split(/(?<=[.!?])\s+|\n/)[0] ?? "";
  const words = first.split(/\s+/).filter(Boolean);
  const cut = words.slice(0, 8).join(" ").replace(/[.!?,;:]+$/, "");
  const t = (words.length > 8 ? `${cut}…` : cut).slice(0, LIMIT.title);
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Your proposal";
}

/** One screen gets a variant beside the current frame; several screens version the flow (see the draft workflow). */
export const modeFor = (frames: readonly string[]): "variant" | "round" => (frames.length > 1 ? "round" : "variant");

/** Keep PMA's chosen mode while the screens stay the same; re-derive it once the PM changes the screens. */
export function modeAfterEdit(prev: { mode: string; target_frames: readonly string[] }, nextFrames: readonly string[]): string {
  const same = prev.target_frames.length === nextFrames.length && prev.target_frames.every((f) => nextFrames.includes(f));
  return same ? prev.mode : modeFor(nextFrames);
}

/** Smart default for Write your own: the screens PMA's recommended fix touches, else where the flow ends up. */
export function defaultScreens(solutions: { recommended: boolean; target_frames: string[] }[], flow: readonly string[]): string[] {
  const rec = solutions.find((s) => s.recommended)?.target_frames ?? [];
  if (rec.length) return [...rec];
  return flow.length ? [flow[flow.length - 1]] : [];
}

type SolutionRow = { title: string; summary: string; tradeoffs: string | null; effort: string | null; risk: string | null; mode: string; target_frames: string[] };
/** PMA's version of a proposal, kept on the first PM edit so it can be restored. */
export function snapshotOriginal<T extends SolutionRow>(s: T): SolutionRow {
  return { title: s.title, summary: s.summary, tradeoffs: s.tradeoffs, effort: s.effort, risk: s.risk, mode: s.mode, target_frames: s.target_frames };
}

/** When PMA re-proposes: replace only its own untouched proposals; PM-written and edited ones stay. */
export function regeneratePlan(existing: { id: string; origin: string; edited_at: string | null; rank: number; recommended: boolean }[]): { deleteIds: string[]; nextRank: number; keptRecommended: boolean } {
  const replace = (s: (typeof existing)[number]) => s.origin === "ai" && !s.edited_at;
  const kept = existing.filter((s) => !replace(s));
  return {
    deleteIds: existing.filter(replace).map((s) => s.id),
    nextRank: kept.reduce((m, s) => Math.max(m, s.rank), 0) + 1,
    keptRecommended: kept.some((s) => s.recommended),
  };
}

/** Why a proposal can't be edited right now, or null when it can. */
export function editLocked(stage: Stage, draftSolutionId: string | null, solutionId: string): string | null {
  if (draftSolutionId !== solutionId) return null;
  if (stage === "drafting") return "Drafting now. You can edit it when the draft is ready.";
  if (stage === "shipped") return "Shipped";
  // Copy task hands the approved proposal and its mock-up to Claude Code, so they stay as they were approved.
  if (stage === "ready_to_build") return "Approved";
  return null;
}

/** The drafted proposal was edited after its draft started, so the draft no longer matches it. */
export function changedSinceDraft(s: { id: string; edited_at: string | null }, draft: { solution_id: string | null; created_at: string } | null): boolean {
  if (!draft || draft.solution_id !== s.id || !s.edited_at) return false;
  return Date.parse(s.edited_at) > Date.parse(draft.created_at);
}

export function provenanceLabel(s: { origin: string; edited_at: string | null; edited_by_email: string | null }, me: string | null): { kind: "ai" | "edited" | "pm"; label: string } {
  const mine = !!me && s.edited_by_email === me;
  if (s.origin === "pm") return { kind: "pm", label: mine ? "Yours" : s.edited_by_email ? `By ${initials(s.edited_by_email)}` : "Written by your team" };
  if (!s.edited_at) return { kind: "ai", label: "PMA" };
  return { kind: "edited", label: mine ? "Edited by you" : s.edited_by_email ? `Edited by ${initials(s.edited_by_email)}` : "Edited" };
}

/**
 * Who the change is for, in the form's question "What changes for the {noun}?": the app's own audience ("member",
 * "shopper"), which wins when mixed, else its staff.
 */
export function audienceNoun(audiences: readonly string[], profile: ProductProfile): string {
  return audiences.includes("users") || !audiences.includes("staff") ? profile.audience_one : "staff member";
}

/** audienceNoun for several of them: an app's own plural ("shoppers", or "people" before it is described), never an
 *  "s" added to "person". */
export function audienceNounPlural(audiences: readonly string[], profile: ProductProfile): string {
  return audiences.includes("users") || !audiences.includes("staff") ? profile.audience : "staff members";
}

/**
 * How many people raised an issue, in the words the issue header uses: "1 shopper", "3 shoppers" (audienceNoun and its
 * plural; "1 person", "3 people" for an app not yet described). The Desk card says the same for a customer app.
 */
export function peopleWords(count: number, audiences: readonly string[], profile: ProductProfile): string {
  const n = Math.round(count);
  return `${n} ${n === 1 ? audienceNoun(audiences, profile) : audienceNounPlural(audiences, profile)}`;
}

/**
 * A count of people as Why it matters and the feedback page say it: in the app's own audience words (peopleWords, as
 * the issue header says it), or "1 person" / "3 people" without a profile.
 */
export function peopleLabelFor(count: number, audiences: readonly string[], profile: ProductProfile | null | undefined): string {
  return profile ? peopleWords(count, audiences, profile) : peopleLabel(count);
}

/**
 * For Slack's issue card and alert, which read the issue row with its app and pieces: a customer app's count of people
 * in its audience words ("1 shopper"), as the issue page says it, or undefined for the demo (and when the app didn't
 * load), whose messages keep "1 person".
 */
export function peopleTextFor(project: ProfileSource | null | undefined, count: number, units: { audience?: string | null }[] | null | undefined): string | undefined {
  if (!project || typeof project.kind !== "string" || project.kind === "demo") return undefined;
  const audiences = [...new Set((units ?? []).map((u) => u.audience).filter((a): a is string => !!a))];
  return peopleWords(count, audiences, profileOf(project));
}

/** Why the last attempt to write proposals stopped, in plain words, if it failed after the last proposals landed.
 *  Alerts and Slack failures are about something else. Activity is newest first. */
export function proposalFailure(activity: { kind: string; payload: Record<string, unknown> | null }[]): string | null {
  for (const a of activity) {
    if (a.kind === "proposals_ready") return null;
    if (a.kind === "lane_action_failed" && a.payload?.lane !== "alerts" && a.payload?.lane !== "slack") {
      return `Proposals didn't finish: ${friendlyLlmError(typeof a.payload?.error === "string" ? a.payload.error : null)}`;
    }
  }
  return null;
}
