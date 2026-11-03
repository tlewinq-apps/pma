// Pure helpers for the Projects tab: what has been done on an owned issue, by whom and why, and its updates and
// comments as threads. No server imports, so the page and the tests share them.
import { joinNames } from "@/components/triage/format";
import { checkOf } from "@/lib/diagnosis/checks";
import { describeActivity } from "./issueHelpers";

export type ProjectActivity = { id: number; kind: string; user_id: string | null; payload: Record<string, unknown> | null; at: string };
export type ProjectStep = { id: number; what: string; why: string | null; who: string; at: string };
export type CommentPost = {
  id: number; userId: string | null; who: string; text: string; at: string;
  /** A top-level post by the owner is an update; anything else is a comment. */
  kind: "update" | "comment";
  via: "web" | "slack";
  replies: CommentPost[];
};

/** Rows that aren't work done on the project: reads, the conversation (shown on its own), and housekeeping. */
const NOT_STEPS = new Set(["viewed", "commented", "slack_sent", "slack_failed", "lane_changed", "lane_action_failed", "alert", "feedback_added", "followups_drafted", "draft_skipped"]);

const str = (v: unknown) => (v == null ? "" : String(v));
const sentence = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const orNull = (v: unknown) => str(v).trim() || null;

type Context = {
  type: string;
  solutions: { id: string; title: string; summary: string }[];
  /** The proposal the latest mock-up drew, which is the one that ships. */
  draftSolutionId: string | null;
};

/** One activity row as a step: what happened and, when an earlier step left one behind, why. Null for non-steps. */
export function projectStep(a: ProjectActivity, ctx: Context): Omit<ProjectStep, "id" | "who" | "at"> | null {
  if (NOT_STEPS.has(a.kind)) return null;
  const p = a.payload ?? {};
  const check = checkOf(str(p.type) || ctx.type);
  const summaryOf = (title: unknown) => ctx.solutions.find((s) => s.title === str(title))?.summary ?? null;
  switch (a.kind) {
    case "assigned": return { what: p.to === "me" ? "Took it on" : "Stepped off it", why: null };
    case "diagnosis_started": return { what: `${sentence(check.started)}${p.screen ? ` on ${str(p.screen)}` : ""}`, why: null };
    case "diagnosis_ready": return { what: check.done.replace(/\.$/, ""), why: orNull(p.headline ?? p.cause) };
    case "proposals_ready": {
      const n = Number(p.count) || ctx.solutions.length;
      return { what: `Wrote ${n} ${n === 1 ? "proposal" : "proposals"}${p.from_diagnosis ? ` from the ${check.result.toLowerCase()}` : ""}`, why: ctx.solutions.length ? joinNames(ctx.solutions.slice(0, 3).map((s) => s.title)) : null };
    }
    case "proposal_added": return { what: "Added a proposal", why: orNull(p.title) };
    case "proposal_edited": return { what: "Edited a proposal", why: orNull(p.title) };
    case "proposal_removed": return { what: "Removed a proposal", why: orNull(p.title) };
    case "proposal_restored": return { what: "Restored PMA's proposal", why: orNull(p.title) };
    case "draft_dispatched": return { what: p.solution ? `Mocked up "${str(p.solution)}"` : "Started a mock-up", why: summaryOf(p.solution) };
    case "draft_ready": return { what: "Mock-up ready for review", why: null };
    case "draft_failed": return { what: "Mock-up didn't finish", why: null };
    case "changes_requested": return { what: "Asked for changes", why: orNull(p.note) };
    case "flow_requested": return { what: `Asked for the full ${p.flow ? `${str(p.flow)} ` : ""}flow`, why: null };
    case "flow_ready": return { what: "Drew the full flow", why: orNull(p.summary) };
    case "flow_failed": return { what: "Full flow didn't finish", why: orNull(p.error) };
    // A customer app's approximate mock-up is approved, not shipped (it is ready to build).
    case "approved": return { what: p.approximate ? "Approved the mock-up" : "Approved and shipped", why: ctx.solutions.find((s) => s.id === ctx.draftSolutionId)?.summary ?? null };
    case "decision": return { what: "Recorded a decision", why: orNull(p.text) };
    case "priority_changed":
      if (p.from == null) return { what: "First rated", why: null };
      return { what: Number(p.to) >= Number(p.from) ? "Rose in priority" : "Fell in priority", why: orNull(p.reason) };
    case "followups_asked": return { what: `Asked ${joinNames(p.names)} follow-up questions`, why: null };
    case "followup_answered": return { what: `${str(p.name) || "Someone"} answered the follow-up`, why: orNull(p.quote) };
    case "reporters_told": return { what: `Told ${joinNames(p.names)} it shipped`, why: null };
    default: return { what: sentence(describeActivity(a).text), why: null };
  }
}

/** Every step taken on the project, newest first. Rows without a person were PMA's own (a run, a mock-up). */
export function projectTimeline(activity: ProjectActivity[], names: Map<string, string>, ctx: Context): ProjectStep[] {
  return [...activity]
    .sort((x, y) => y.at.localeCompare(x.at) || y.id - x.id)
    .flatMap((a) => {
      const s = projectStep(a, ctx);
      return s ? [{ id: a.id, ...s, who: a.user_id ? names.get(a.user_id) ?? "A teammate" : "PMA", at: a.at }] : [];
    });
}

/**
 * Updates and comments as threads: newest thread first, replies oldest first underneath. A reply whose parent is gone
 * stands on its own. Slack thread replies arrive without a parent, so they are top-level.
 */
export function threadComments(activity: ProjectActivity[], names: Map<string, string>, ownerId: string | null): CommentPost[] {
  const rows = activity.filter((a) => a.kind === "commented").sort((x, y) => x.at.localeCompare(y.at) || x.id - y.id);
  const ids = new Set(rows.map((r) => r.id));
  const post = (a: ProjectActivity, top: boolean): CommentPost => {
    const p = a.payload ?? {};
    return {
      id: a.id, userId: a.user_id, text: str(p.text), at: a.at,
      who: (a.user_id ? names.get(a.user_id) : null) ?? (str(p.name) || "Someone"),
      kind: top && !!ownerId && a.user_id === ownerId ? "update" : "comment",
      via: p.source === "slack" ? "slack" : "web",
      replies: [],
    };
  };
  const parentOf = (a: ProjectActivity) => { const r = Number(a.payload?.reply_to); return Number.isFinite(r) && ids.has(r) && r !== a.id ? r : null; };
  const threads = new Map<number, CommentPost>();
  for (const a of rows) if (parentOf(a) === null) threads.set(a.id, post(a, true));
  for (const a of rows) {
    const parent = parentOf(a);
    if (parent === null) continue;
    // A reply to a reply joins its parent's thread, so threads stay one level deep.
    const root = threads.get(parent) ?? [...threads.values()].find((t) => t.replies.some((r) => r.id === parent));
    if (root) root.replies.push(post(a, false));
    else threads.set(a.id, post(a, true));
  }
  return [...threads.values()].sort((x, y) => y.at.localeCompare(x.at) || y.id - x.id);
}

export const COMMENT_MAX = 2000;

export function parseCommentBody(body: unknown): { text: string; replyTo: number | null } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) return { error: "write something first" };
  if (text.length > COMMENT_MAX) return { error: `keep it under ${COMMENT_MAX} characters` };
  if (b.replyTo == null) return { text, replyTo: null };
  const replyTo = Number(b.replyTo);
  return Number.isSafeInteger(replyTo) && replyTo > 0 ? { text, replyTo } : { error: "invalid replyTo" };
}
