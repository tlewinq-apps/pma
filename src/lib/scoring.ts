import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, SCOPE_VALUE, type IssueType, type Lane, type Scope, type Thresholds, type Weights } from "./types";

export interface PeopleUnit { speakers: string[]; corroborators: string[]; reportedCount: number }
export interface ImportanceInputs {
  severity: number;            // 1..5
  reach: number;               // 0..1
  peopleCount: number;
  meanSentiment: number;       // -2..2
  frustrated: boolean;
  daysSinceLastReport: number;
}
export interface EaseInputs { scope: Scope; clarity: number /* 1..5 */; mappingConfidence: number /* 0..1 */ }
export interface RouteInputs { importance: number; ease: number; type: IssueType; recentReports7d: number }

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const rubric01 = (n: number) => clamp01((n - 1) / 4);
const norm = (s: string) => s.trim().toLowerCase();

/** Distinct named people (speakers and corroborators), and how many more they said they spoke for. */
export function peopleParts(units: PeopleUnit[]): { distinct: number; reported: number } {
  const people = new Set<string>();
  let reported = 0;
  for (const u of units) {
    for (const p of [...u.speakers, ...u.corroborators]) if (p.trim()) people.add(norm(p));
    reported += Math.max(0, u.reportedCount);
  }
  return { distinct: people.size, reported };
}

/** People reported for others ("three members said") count half: second-hand, but not nothing. */
export function countPeople(units: PeopleUnit[]): number {
  const { distinct, reported } = peopleParts(units);
  return distinct + 0.5 * reported;
}

export function computeImportance(i: ImportanceInputs, w: Weights = DEFAULT_WEIGHTS): number {
  const f = importanceFactors(i);
  return Math.round(100 * FACTOR_ORDER.reduce((sum, k) => sum + w.importance[k] * f[k], 0));
}

export function computeEase(i: EaseInputs, w: Weights = DEFAULT_WEIGHTS): number {
  const x = w.ease;
  return Math.round(100 * (x.scope * (1 - SCOPE_VALUE[i.scope]) + x.clarity * rubric01(i.clarity) + x.mapping * clamp01(i.mappingConfidence)));
}

export function routeLane(i: RouteInputs, t: Thresholds = DEFAULT_THRESHOLDS): Lane {
  if (i.importance >= t.importanceHigh) {
    if (i.ease >= t.easeHigh && i.type !== "new_feature") return "quick_win";
    return "explore";
  }
  if (i.importance >= t.watchMin && i.recentReports7d >= t.watchRecentReports) return "watch";
  return "backlog";
}

export type FactorKey = "severity" | "reach" | "frequency" | "intensity" | "recency";
export const FACTOR_ORDER: readonly FactorKey[] = ["severity", "reach", "frequency", "intensity", "recency"];

/** Each factor's 0..1 value, before weighting (the same terms computeImportance adds up). */
export function importanceFactors(i: ImportanceInputs): Record<FactorKey, number> {
  return {
    severity: rubric01(i.severity),
    reach: clamp01(i.reach),
    frequency: Math.min(1, Math.log2(1 + i.peopleCount) / Math.log2(11)),
    intensity: clamp01(Math.abs(i.meanSentiment) / 2 + (i.frustrated ? 0.25 : 0)),
    recency: Math.exp(-Math.max(0, i.daysSinceLastReport) / 30),
  };
}

/**
 * Whole points per factor that add up exactly to computeImportance (largest-remainder rounding), so "Why this
 * priority" can show "+35, +25, …" without the total drifting by one.
 */
export function explainImportance(i: ImportanceInputs, w: Weights = DEFAULT_WEIGHTS): { total: number; points: Record<FactorKey, number> } {
  const total = computeImportance(i, w);
  const f = importanceFactors(i);
  const raw = FACTOR_ORDER.map((k) => ({ k, v: 100 * w.importance[k] * f[k] }));
  const points = Object.fromEntries(raw.map(({ k, v }) => [k, Math.floor(v)])) as Record<FactorKey, number>;
  let left = total - Object.values(points).reduce((a, b) => a + b, 0);
  for (const { k } of [...raw].sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)))) {
    if (left <= 0) break;
    points[k] += 1;
    left -= 1;
  }
  return { total, points };
}

export type SignalCounts = { blocks_task: number; has_workaround: number; data_loss: number; frequency_words: number; of: number };
/** How many pieces of feedback say it blocks them, has a workaround, lost data, or happens every time. */
export function aggregateSignals(units: { severity_signals: Record<string, boolean> | null }[]): SignalCounts {
  const n = (k: keyof Omit<SignalCounts, "of">) => units.filter((u) => u.severity_signals?.[k]).length;
  return { blocks_task: n("blocks_task"), has_workaround: n("has_workaround"), data_loss: n("data_loss"), frequency_words: n("frequency_words"), of: units.length };
}

/** What rescoreIssue stores so the explanation can be shown later and the score can age without another LLM call. */
export type ScoreInputs = Omit<ImportanceInputs, "daysSinceLastReport"> & { lastReportAt: string; distinctPeople: number; reportedByOthers: number };

/** Why the score moved, in words, for the `priority_changed` activity. `prevImportance` covers issues scored before inputs were stored. */
export function priorityReason(prev: ScoreInputs | undefined, next: ScoreInputs, prevImportance: number | null = null): string {
  if (!prev) return prevImportance == null ? "First scored" : "Re-rated with new feedback";
  const parts: string[] = [];
  const morePeople = Math.round(next.peopleCount - prev.peopleCount);
  if (morePeople > 0) parts.push(`${morePeople} more ${morePeople === 1 ? "person" : "people"}`);
  if (morePeople < 0) parts.push(`${-morePeople} fewer ${morePeople === -1 ? "person" : "people"}`);
  if (next.severity !== prev.severity) parts.push(next.severity > prev.severity ? "rated more severe" : "rated less severe");
  if (next.reach !== prev.reach) parts.push(next.reach > prev.reach ? "seen as more widespread" : "seen as less widespread");
  if (!parts.length && Date.parse(next.lastReportAt) > Date.parse(prev.lastReportAt)) parts.push("new reports");
  if (!parts.length) parts.push("older reports count for less");
  const s = parts.join(", ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type PriorityChange = { at: string; from: number | null; to: number };
/**
 * The priority the issue had `windowMs` ago and now. The baseline is the last change before the window, or the
 * earliest change inside it; an issue first scored inside the window has no baseline (it is new, not a jump).
 */
export function priorityChangeSince(history: PriorityChange[], current: number, now: number, windowMs: number): { from: number; to: number } | null {
  const start = now - windowMs;
  const sorted = [...history].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const before = sorted.filter((h) => Date.parse(h.at) < start).at(-1);
  const baseline = before ? before.to : sorted.find((h) => Date.parse(h.at) >= start)?.from ?? null;
  return baseline == null ? null : { from: baseline, to: current };
}

/**
 * The daily re-score without an LLM call: the same stored inputs, one day older, so recency fades and a quiet issue
 * leaves Rising. Null when nothing would change (or the issue predates stored inputs).
 */
export function agedScore(
  issue: { importance: number | null; ease: number | null; type: IssueType; lane: Lane | null; breakdown: { inputs?: ScoreInputs } | null },
  recentReports7d: number, now: number, w: Weights = DEFAULT_WEIGHTS, t: Thresholds = DEFAULT_THRESHOLDS,
): { importance: number; points: Record<FactorKey, number>; lane: Lane } | null {
  const inputs = issue.breakdown?.inputs;
  if (!inputs) return null;
  const { total, points } = explainImportance({ ...inputs, daysSinceLastReport: (now - Date.parse(inputs.lastReportAt)) / 86_400_000 }, w);
  const lane = routeLane({ importance: total, ease: issue.ease ?? 0, type: issue.type, recentReports7d }, t);
  if (total === issue.importance && lane === issue.lane) return null;
  return { importance: total, points, lane };
}

/** Priority moves smaller than this are drift: they update the issue but don't get an activity row. */
const PRIORITY_LOG_MIN = 3;

/**
 * The row update and activity for one aged score. The update stamps updated_at, so the board's ordering and the Slack
 * sweep see the issue as changed.
 */
export function agedChange(
  prev: { id: string; importance: number | null; lane: Lane | null; score_breakdown: Record<string, unknown> | null },
  r: { importance: number; lane: Lane; points: Record<FactorKey, number> }, now: number,
) {
  const patch = { importance: r.importance, lane: r.lane, score_breakdown: { ...prev.score_breakdown, points: r.points }, updated_at: new Date(now).toISOString() };
  const log: { issue_id: string; kind: string; payload: Record<string, unknown> }[] = [];
  if (prev.importance == null || Math.abs(r.importance - prev.importance) >= PRIORITY_LOG_MIN) log.push({ issue_id: prev.id, kind: "priority_changed", payload: { from: prev.importance, to: r.importance, reason: "Older reports count for less" } });
  if (r.lane !== prev.lane) log.push({ issue_id: prev.id, kind: "lane_changed", payload: { from: prev.lane, to: r.lane } });
  return { patch, log };
}
