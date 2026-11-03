import { DEFAULT_THRESHOLDS, type IssueStatus, type IssueType, type Lane, type Scope, type Thresholds } from "@/lib/types";
import type { SignalCounts } from "@/lib/scoring";
import { DEMO_PROFILE, type ProductProfile } from "@/lib/product/profile";

export type Emotion = "frustrated" | "confused" | "neutral" | "pleased" | "delighted";
/** Most to least negative: ties in dominantEmotion resolve toward the front, the more actionable signal. */
export const EMOTIONS: readonly Emotion[] = ["frustrated", "confused", "neutral", "pleased", "delighted"];

export const TYPE_LABEL: Record<IssueType, string> = { bug: "Bug", streamline: "Streamline", add_on: "Add-on", new_feature: "New feature" };
export const RAIL_LABEL: Record<IssueType, string> = { bug: "Bugs", new_feature: "New features", add_on: "Add-ons", streamline: "Streamline" };
export const RAIL_ORDER: readonly IssueType[] = ["bug", "new_feature", "add_on", "streamline"];
export const LANE_LABEL: Record<Lane, string> = { quick_win: "Quick win", explore: "Needs a decision", watch: "Rising", backlog: "Backlog" };
export const EMOTION_LABEL: Record<Emotion, string> = { frustrated: "Frustrated", confused: "Confused", neutral: "Neutral", pleased: "Pleased", delighted: "Delighted" };
export const EMOTION_TONE: Record<Emotion, string> = { frustrated: "text-tone-negative", confused: "text-tone-caution", neutral: "text-muted-foreground", pleased: "text-tone-positive", delighted: "text-tone-positive" };
export const SCOPE_LABEL: Record<Scope, string> = { copy: "Copy change", single_screen: "One screen", multi_screen: "Several screens", new_flow: "New flow", new_flow_backend: "New flow + backend" };
/** Impact on the user, in PM words, from the severity rating (1-5). The coloured word on cards and the issue header. */
export const SEVERITY_LABEL: Record<number, string> = { 1: "Cosmetic", 2: "Annoyance", 3: "Slows users down", 4: "Needs a workaround", 5: "Blocker" };
export const IMPACT_TONE: Record<number, string> = { 1: "text-muted-foreground", 2: "text-muted-foreground", 3: "text-tone-caution", 4: "text-tone-caution", 5: "text-tone-negative" };
/** "Blocker", or null when the issue hasn't been rated yet. */
export const impactLabel = (severity: number | null | undefined) => (severity ? SEVERITY_LABEL[Math.round(severity)] ?? null : null);
export const CLARITY_LABEL: Record<number, string> = { 1: "Vague", 2: "Loose", 3: "Clear enough", 4: "Specific", 5: "Exact steps" };
/** A piece of feedback's sentiment (-2..2) in words. */
export const SENTIMENT_LABEL: Record<number, string> = { [-2]: "Very negative", [-1]: "Negative", 0: "Neutral", 1: "Positive", 2: "Very positive" };
export const SENTIMENT_TONE: Record<number, string> = { [-2]: "text-tone-negative", [-1]: "text-tone-caution", 0: "text-muted-foreground", 1: "text-tone-positive", 2: "text-tone-positive" };
/** What a piece of feedback says happened to them, from the classifier's signals. */
export const SIGNAL_LABEL: Record<string, string> = { blocks_task: "Blocks the task", data_loss: "Lost data", has_workaround: "Has a workaround", frequency_words: "Happens every time" };
/** The classifier's audiences as one person, several and a group, in an app's own words. */
export type AudienceWords = { one: Record<string, string>; many: Record<string, string>; group: Record<string, string> };
/** An app's "users" are its own audience ("member" / "members"), beside its staff and leaders. */
export function audienceWords(p: ProductProfile): AudienceWords {
  return {
    one: { users: p.audience_one, staff: "staff member", leadership: "leader" },
    many: { users: p.audience, staff: "staff members", leadership: "leaders" },
    group: { users: p.audience.charAt(0).toUpperCase() + p.audience.slice(1), staff: "Staff", leadership: "Leaders" },
  };
}
/** The demo app's words ("member" / "members"), for callers with no profile at hand. */
export const DEMO_AUDIENCE_WORDS: AudienceWords = audienceWords(DEMO_PROFILE);
/** The demo's words as one person and as a group, for the lists that only need those. */
export const AUDIENCE_ONE: Record<string, string> = DEMO_AUDIENCE_WORDS.one;
export const AUDIENCE_GROUP: Record<string, string> = DEMO_AUDIENCE_WORDS.group;
export const EFFORT_LABEL: Record<string, string> = { S: "Small effort", M: "Medium effort", L: "Large effort" };
export const RISK_LABEL: Record<string, string> = { low: "Low risk", medium: "Medium risk", high: "High risk" };
const STATUS: Record<IssueStatus, string> = { new: "New", drafting: "Drafting", draft_ready: "Ready for review", in_review: "In review", ready_to_build: "Ready to build", shipped: "Shipped", dismissed: "Dismissed" };

export const typeLabel = (t: IssueType) => TYPE_LABEL[t];
export const statusLabel = (s: IssueStatus) => STATUS[s];
/** "A, B and C". Anything that isn't a list (a malformed activity payload) reads as no names. */
export function joinNames(v: unknown): string {
  const xs = Array.isArray(v) ? v.map(String) : [];
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
}
export function peopleLabel(n: number) {
  const r = Math.round(n);
  return `${r} ${r === 1 ? "person" : "people"}`;
}
/** The rating rubric anchors reach at 1.0 (core daily flow), 0.5 (occasional) and 0.3 (edge). */
export const reachLabel = (r: number) => (r >= 0.9 ? "Core flow" : r >= 0.6 ? "Common flow" : r >= 0.45 ? "Occasional flow" : "Edge flow");
export const matchLabel = (c: number) => (c >= 0.8 ? "Strong match" : c >= 0.5 ? "Likely match" : "Weak match");
export function initials(email: string) {
  const name = email.split("@")[0].split(/[._-]/).filter(Boolean);
  return (name.length > 1 ? name[0][0] + name[1][0] : name[0]?.slice(0, 2) ?? "?").toUpperCase();
}
/** "maya.okafor@x.is" → "Maya Okafor": a person's name when Slack doesn't know them. */
export function nameFromEmail(email: string): string {
  const parts = email.split("@")[0].split(/[._-]+/).filter(Boolean);
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ") || email;
}
/** "friends › Friends" → "Friends › Friends": scenes are folder names, shown capitalised. */
export const flowLabel = (flow: string | null) => (flow ? flow.charAt(0).toUpperCase() + flow.slice(1) : "Unmapped");
export const sceneOf = (flow: string | null) => (flow ? flow.split(" › ")[0] : null);
export function timeAgo(at: string, now: number): string {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** Priority in a word next to the number, by the project's lane thresholds (60 and 35 by default). */
export function priorityBand(n: number, t: Thresholds = DEFAULT_THRESHOLDS): "High" | "Medium" | "Low" {
  return n >= t.importanceHigh ? "High" : n >= t.watchMin ? "Medium" : "Low";
}

/** How strongly people feel about an issue, from the mean sentiment (-2..2) and whether anyone was frustrated. */
export function feelingLabel(meanSentiment: number, frustrated: boolean): string {
  if (frustrated) return "Frustrated";
  if (meanSentiment <= -1) return "Upset";
  if (meanSentiment <= -0.5) return "Annoyed";
  if (meanSentiment >= 1) return "Keen";
  if (meanSentiment >= 0.5) return "Interested";
  return "Matter-of-fact";
}

export function lastHeardLabel(at: string, now: number): string {
  const days = Math.floor((now - Date.parse(at)) / 86_400_000);
  if (days < 1) return "Last heard today";
  if (days < 2) return "Last heard yesterday";
  if (days < 14) return `Last heard ${days} days ago`;
  return `Last heard ${Math.floor(days / 7)} weeks ago`;
}

/** "9 people", or "1 person, plus 2 others they mentioned" when someone reports for others ("three members said"). */
export function peopleDetail(distinct: number, reportedByOthers: number, label: (n: number) => string = peopleLabel): string {
  const base = label(distinct);
  if (!reportedByOthers) return base;
  return `${base}, plus ${reportedByOthers} ${reportedByOthers === 1 ? "other" : "others"} they mentioned`;
}

export function signalsLabel(s: SignalCounts): string | null {
  const parts = signalParts(s);
  return parts.length ? parts.join(" · ") : null;
}

/** The counted signals as short phrases: "1 of 1 says it blocks them", "2 have a workaround". */
export function signalParts(s: SignalCounts): string[] {
  const one = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;
  return [
    s.blocks_task ? `${s.blocks_task} of ${s.of} ${s.blocks_task === 1 ? "says" : "say"} it blocks them` : null,
    s.has_workaround ? one(s.has_workaround, "has a workaround", "have a workaround") : null,
    s.data_loss ? `${s.data_loss} lost data` : null,
    s.frequency_words ? `${s.frequency_words} ${s.frequency_words === 1 ? "says" : "say"} it happens every time` : null,
  ].filter((x): x is string => !!x);
}

/** "Up 19 since yesterday" from priorityChangeSince; moves under 3 points are rating noise and stay unsaid. */
export function priorityTrendLabel(change: { from: number; to: number } | null): string | null {
  if (!change) return null;
  const d = change.to - change.from;
  if (Math.abs(d) < 3) return null;
  return `${d > 0 ? "Up" : "Down"} ${Math.abs(d)} since yesterday`;
}
