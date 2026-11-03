// Why it matters, pure core: the issue's urgency, stakeholders and fixability out of 10, how people feel, a one-line
// verdict, and where it sits on a flow. Urgency is lib/urgency's, the same number as the Desk badge; stakeholders
// regroups the priority factors (scoring.ts), so it agrees with how the Desk sorts; fixability is the stored ease.
// Everything is read from what the pipeline already stored, so it costs no model call. Shared by the issue panel
// (client) and the feedback page (server).
import { DEFAULT_WEIGHTS, type IssueType, type Scope, type Weights } from "./types";
import { aggregateSignals, computeEase, importanceFactors, type ScoreInputs, type SignalCounts } from "./scoring";
import type { ProductProfile } from "./product/profile";
import { peopleLabelFor } from "./proposals";
import { reportStats, scoreUrgency, weekTrend } from "./urgency";
import {
  DEMO_AUDIENCE_WORDS, audienceWords, type AudienceWords, CLARITY_LABEL, EFFORT_LABEL, EMOTIONS, EMOTION_LABEL, RISK_LABEL, SCOPE_LABEL, SENTIMENT_LABEL, SEVERITY_LABEL,
  feelingLabel, lastHeardLabel, matchLabel, peopleDetail, reachLabel, signalParts, type Emotion,
} from "@/components/triage/format";

export type AnalysisUnit = {
  sentiment: number | null; emotion: string | null; audience: string | null; speakers: string[];
  signals?: Record<string, boolean> | null;
  /** When the feedback happened (its source's occurred_at). */
  at: string; author?: string | null; channel?: string | null;
  /** Who else was named, and how many more they said they spoke for (urgency's people count). */
  corroborators?: string[]; reportedCount?: number;
};
export type AnalysisBreakdown = {
  severity: number; clarity: number; scope: string; reach: number; rationale?: Record<string, string>;
  mappingConfidence?: number; peopleCount?: number; inputs?: ScoreInputs; signals?: SignalCounts;
};
export type AnalysisInput = {
  type: IssueType; breakdown: AnalysisBreakdown | null; ease: number | null; peopleCount: number;
  units: AnalysisUnit[];
  screens: { frame_id: string; title: string | null; confidence: number }[];
  /** The first step's finding once it's done (a bug's diagnosis, a feature's scope, ...). */
  finding: { headline: string } | null;
  recommended: { effort: string | null; risk: string | null } | null;
  weights?: Weights | null;
  /** The app's product (profileOf), for the audience words; the demo's when unset. */
  profile?: ProductProfile | null;
  /** PostHog users on its linked errors and rage clicks on its screens, last 30 days (posthog/reach); urgency counts them. */
  phUsers30?: number;
};

export type Reason = { lead: string; text: string };
export type Part = { label: string; value: string };
export type ScoreKey = "urgency" | "stakeholders" | "fixability";
export type Score = { key: ScoreKey; name: string; score: number; word: string; tone: string | null; reasons: Reason[]; parts: Part[] };
export type Feeling = {
  word: string; tone: string; text: string;
  /** One bucket per sentiment, most negative first, with how many pieces landed in it. */
  buckets: { value: number; label: string; count: number }[];
  emotions: { emotion: Emotion; count: number }[];
};
export type Analysis = { urgency: Score; stakeholders: Score; fixability: Score; feeling: Feeling | null; verdict: string };

const DAY = 86_400_000;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
/** 0..1 → a whole number out of 10. */
export const outOf10 = (x: number) => Math.round(clamp01(x) * 10);
const sentence = (s: string | null | undefined) => (s?.trim() ? s.trim().replace(/([^.!?])$/, "$1.") : "");
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** The first sentence, cut at a word near `max` when even that runs long (a first step's finding can be a paragraph). */
export function firstSentence(s: string, max = 160): string {
  const one = (s.trim().match(/^.*?[.!?](?=\s|$)/)?.[0] ?? s.trim()).trim();
  if (one.length <= max) return sentence(one);
  return `${one.slice(0, max).replace(/[\s,;:]+\S*$/, "")}…`;
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** 2, or 2.5 for a median between two weeks. */
const tenths = (n: number) => String(Math.round(n * 10) / 10);
/** "A, B and C". */
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
/** "a core flow", "an occasional flow". */
const withArticle = (s: string) => `${/^[aeiou]/i.test(s) ? "an" : "a"} ${s}`;

export const URGENCY_WORDS = ["Can wait", "When there's room", "Plan for soon", "Act this week"] as const;
export function urgencyWord(score: number): (typeof URGENCY_WORDS)[number] {
  return score >= 8 ? "Act this week" : score >= 6 ? "Plan for soon" : score >= 4 ? "When there's room" : "Can wait";
}
export function urgencyTone(score: number): string {
  return score >= 8 ? "text-tone-negative" : score >= 6 ? "text-tone-caution" : "text-muted-foreground";
}
export function fixBand(score: number): "Easy" | "Moderate" | "Takes work" | "Hard" {
  return score >= 8 ? "Easy" : score >= 6 ? "Moderate" : score >= 4 ? "Takes work" : "Hard";
}

/** The audiences that raised it, most common first; unknown only when nothing else is known. */
function audienceCounts(units: AnalysisUnit[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const u of units) if (u.audience && u.audience !== "unknown") counts.set(u.audience, (counts.get(u.audience) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}
/** "1 member", "2 staff members", "3 people" (a customer app: "1 shopper"). */
export function audienceCount(audience: string | null, n: number, words: AudienceWords = DEMO_AUDIENCE_WORDS): string {
  const one = audience ? words.one[audience] : undefined;
  return `${n} ${!one ? (n === 1 ? "person" : "people") : n === 1 ? one : words.many[audience!] ?? `${one}s`}`;
}
/** "The one piece came from a parent.", "Both pieces came from parents.", "All 4 pieces came from staff members." */
function fromAudience(audience: string, n: number, words: AudienceWords): string {
  const one = words.one[audience] ?? "person";
  const many = audienceCount(audience, 2, words).replace(/^2 /, "");
  return n === 1 ? `The one piece came from ${withArticle(one)}.` : `${n === 2 ? "Both pieces" : `All ${n} pieces`} came from ${many}.`;
}
/** "Members", "Members and staff", or "People" when nobody said who they are. */
export function audienceGroup(units: AnalysisUnit[], words: AudienceWords = DEMO_AUDIENCE_WORDS): string {
  const known = audienceCounts(units).map(([a]) => words.group[a]).filter(Boolean);
  if (!known.length) return "People";
  return andList(known.map((g, k) => (k ? g.toLowerCase() : g)));
}

/** Who said it, by name, with how they reached us: "Jordan Lee on a support call". */
function namedPeople(units: AnalysisUnit[]): string[] {
  const seen = new Map<string, string | null>();
  for (const u of units) {
    const names = u.speakers.filter((s) => s.trim()).length ? u.speakers : u.author ? [u.author] : [];
    for (const n of names) if (!seen.has(n.trim().toLowerCase())) seen.set(n.trim().toLowerCase(), `${n.trim()}${u.channel ? ` (${u.channel})` : ""}`);
  }
  return [...seen.values()].filter((x): x is string => !!x);
}

/**
 * Urgency out of 10 from lib/urgency: severity sets the band, people in the last 30 days and a rising week move it
 * up, and quiet time fades it. The Desk badge reads the same two calls on the same pieces, so they always agree.
 */
function urgency(i: AnalysisInput, b: AnalysisBreakdown, now: number): Score {
  const severity = b.inputs?.severity ?? b.severity;
  const sev = Math.round(severity);
  const stats = reportStats(i.units, now, i.phUsers30 ?? 0);
  const ph = stats.phUsers30 ?? 0;
  const { score } = scoreUrgency(severity, stats, now);
  const last = stats.lastSignalAt;
  const people = stats.distinct30 + stats.others30;
  const say = peopleSayer(i);
  const others = stats.others30 ? `${stats.others30} ${stats.others30 === 1 ? "other" : "others"}` : "";
  const trend = weekTrend(stats.weekly);
  const signals = b.signals ?? aggregateSignals(i.units.map((u) => ({ severity_signals: u.signals ?? null })));
  const said = signalParts(signals);
  const lead = signals.data_loss ? "Lost data" : signals.blocks_task ? "Blocks the task" : signals.has_workaround ? "Has a workaround" : "Every time";
  const week = i.units.filter((u) => now - Date.parse(u.at) < 7 * DAY).length;
  const reasons: Reason[] = [
    { lead: SEVERITY_LABEL[sev] ?? "Impact", text: sentence(b.rationale?.severity) },
    ...(said.length ? [{ lead, text: capital(sentence(said.join(", "))) }] : []),
    ...(people ? [{
      lead: `${say(people)} in 30 days`,
      text: !others ? "" : stats.distinct30 ? `${say(stats.distinct30)} told us, plus ${others} they mentioned.` : `All ${people} mentioned by someone else.`,
    }] : []),
    ...(ph ? [{ lead: `${plural(ph, "PostHog user", "PostHog users")} in 30 days`, text: "On the errors linked to it and rage clicks on its screens." }] : []),
    ...(trend.t ? [{ lead: "Rising this week", text: `${plural(trend.thisWeek, "report", "reports")} this week; a usual week has ${trend.usual ? tenths(trend.usual) : "none"}.` }] : []),
    ...(last ? [{ lead: lastHeardLabel(last, now), text: week ? `${plural(week, "report", "reports")} in the last 7 days.` : "Nothing new in the last 7 days." }] : []),
  ];
  return {
    key: "urgency", name: "Urgency", score, word: urgencyWord(score), tone: urgencyTone(score), reasons: reasons.filter((r) => r.lead || r.text),
    parts: [{ label: "Impact", value: SEVERITY_LABEL[sev] ?? "Not rated" }, { label: "Last report", value: last ? lastHeardLabel(last, now).replace(/^Last heard /, "") : "Unknown" }],
  };
}

const REACH_TEXT: Record<string, string> = {
  "Core flow": "Part of what they do every day.",
  "Common flow": "A flow they use often.",
  "Occasional flow": "A flow they use now and then.",
  "Edge flow": "An edge of the app few people reach.",
};

const wordsOf = (i: AnalysisInput) => (i.profile ? audienceWords(i.profile) : DEMO_AUDIENCE_WORDS);
/**
 * A count of people in the words the issue header uses: a customer app's audience ("1 shopper", "3 shoppers"; "1 person"
 * before the app is described), the demo's "1 person" as before. The audiences are those of the issue's pieces.
 */
function peopleSayer(i: AnalysisInput): (n: number) => string {
  const audiences = [...new Set(i.units.map((u) => u.audience).filter((a): a is string => !!a))];
  return (n) => peopleLabelFor(n, audiences, i.profile);
}

function stakeholders(i: AnalysisInput, b: AnalysisBreakdown, w: Weights): Score {
  const reach = b.inputs?.reach ?? b.reach;
  const peopleCount = b.inputs?.peopleCount ?? b.peopleCount ?? i.peopleCount;
  const f = importanceFactors({ severity: 1, reach, peopleCount, meanSentiment: 0, frustrated: false, daysSinceLastReport: 0 });
  const x = (w.importance.reach * f.reach + w.importance.frequency * f.frequency) / Math.max(1e-9, w.importance.reach + w.importance.frequency);
  const score = outOf10(x);
  const flow = reachLabel(reach);
  const words = wordsOf(i);
  const group = audienceGroup(i.units, words);
  const say = peopleSayer(i);
  const people = b.inputs ? peopleDetail(b.inputs.distinctPeople, b.inputs.reportedByOthers, say) : say(peopleCount);
  const names = namedPeople(i.units);
  const mix = audienceCounts(i.units);
  const reasons: Reason[] = [
    { lead: capital(people), text: names.length ? `${andList(names.slice(0, 3))}${names.length > 3 ? `, and ${names.length - 3} more` : ""}.` : "" },
    { lead: flow, text: REACH_TEXT[flow] ?? "" },
    ...(mix.length > 1 ? [{ lead: "Mixed", text: `${andList(mix.map(([a, n]) => audienceCount(a, n, words)))}.` }]
      : mix.length === 1 ? [{ lead: words.group[mix[0][0]] ?? "People", text: fromAudience(mix[0][0], mix[0][1], words) }] : []),
  ];
  return {
    key: "stakeholders", name: "Stakeholders", score, word: `${group} on ${withArticle(flow.toLowerCase())}`, tone: null, reasons,
    parts: [{ label: "People", value: say(peopleCount) }, { label: "Flow", value: flow }],
  };
}

function fixability(i: AnalysisInput, b: AnalysisBreakdown, w: Weights): Score {
  const mapping = b.mappingConfidence ?? (i.screens.length ? Math.max(...i.screens.map((s) => s.confidence)) : 0);
  const ease = i.ease ?? computeEase({ scope: b.scope as Scope, clarity: b.clarity, mappingConfidence: mapping }, w);
  const score = outOf10(ease / 100);
  const size = SCOPE_LABEL[b.scope as Scope] ?? b.scope;
  const clarity = CLARITY_LABEL[Math.round(b.clarity)] ?? "Not rated";
  const build = i.type === "new_feature";
  const reasons: Reason[] = [
    { lead: size, text: sentence(b.rationale?.scope) },
    { lead: clarity, text: sentence(b.rationale?.clarity) },
    i.finding
      ? { lead: i.type === "bug" ? "Cause found" : "First step done", text: firstSentence(i.finding.headline) }
      : i.type === "bug" ? { lead: "Unconfirmed", text: "The cause is a guess until diagnostics run." } : { lead: "Not checked yet", text: "The first step hasn't run, so this is an estimate." },
    ...(i.recommended?.effort || i.recommended?.risk
      ? [{ lead: "Proposal", text: `${capital([i.recommended.effort ? EFFORT_LABEL[i.recommended.effort] ?? "" : "", i.recommended.risk ? (RISK_LABEL[i.recommended.risk] ?? "").toLowerCase() : ""].filter(Boolean).join(", "))}.` }]
      : []),
  ];
  return {
    key: "fixability", name: build ? "Ease to build" : "Fixability", score, word: `${fixBand(score)}: ${size.toLowerCase()}`, tone: null,
    reasons: reasons.filter((r) => r.text),
    parts: [{ label: "Size", value: size }, { label: "Clarity", value: clarity }, { label: "Screen match", value: i.screens.length ? matchLabel(mapping) : "None yet" }],
  };
}

const FEELING_TONE: Record<string, string> = { Frustrated: "text-tone-negative", Upset: "text-tone-negative", Annoyed: "text-tone-caution", Keen: "text-tone-positive", Interested: "text-tone-positive" };

/** How the people behind it feel, from each piece's sentiment and emotion. Null with no pieces. */
export function feeling(units: Pick<AnalysisUnit, "sentiment" | "emotion">[]): Feeling | null {
  if (!units.length) return null;
  const s = units.map((u) => Math.max(-2, Math.min(2, Math.round(u.sentiment ?? 0))));
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const word = feelingLabel(mean, units.some((u) => u.emotion === "frustrated"));
  const counts = new Map<Emotion, number>();
  for (const u of units) if (u.emotion && (EMOTIONS as readonly string[]).includes(u.emotion)) counts.set(u.emotion as Emotion, (counts.get(u.emotion as Emotion) ?? 0) + 1);
  const emotions = EMOTIONS.filter((e) => counts.has(e)).map((e) => ({ emotion: e, count: counts.get(e)! }));
  const n = s.length, neg = s.filter((v) => v < 0).length, pos = s.filter((v) => v > 0).length;
  const mood = (v: number) => (v < 0 ? "negative" : v > 0 ? "positive" : "neutral");
  const tally = n === 1 ? `The one piece is ${mood(s[0])}`
    : neg === n ? (n === 2 ? "Both pieces are negative" : `All ${n} pieces are negative`)
    : pos === n ? (n === 2 ? "Both pieces are positive" : `All ${n} pieces are positive`)
    : `${neg} of ${n} ${neg === 1 ? "is" : "are"} negative${pos ? `, ${pos} positive` : ""}`;
  const only = emotions.length === 1 ? emotions[0] : null;
  const how = !emotions.length ? ""
    : only && only.count === n ? `${n === 1 ? "it sounds" : n === 2 ? "both sound" : "all sound"} ${EMOTION_LABEL[only.emotion].toLowerCase()}`
    : andList(emotions.map((e, k) => `${e.count}${k ? "" : e.count === 1 ? " sounds" : " sound"} ${EMOTION_LABEL[e.emotion].toLowerCase()}`));
  return {
    word, tone: FEELING_TONE[word] ?? "text-muted-foreground", text: `${tally}${how ? `, and ${how}` : ""}.`,
    buckets: [-2, -1, 0, 1, 2].map((v) => ({ value: v, label: SENTIMENT_LABEL[v], count: s.filter((x) => x === v).length })),
    emotions,
  };
}

/** One plain sentence that leads the panel: "Act this week: it blocks members on a core flow, and the fix looks small." */
export function verdict(i: AnalysisInput, b: AnalysisBreakdown, u: Score, f: Score): string {
  const sev = Math.round(b.inputs?.severity ?? b.severity);
  const words = wordsOf(i);
  const who = audienceGroup(i.units, words).toLowerCase();
  const where = `on ${withArticle(reachLabel(b.inputs?.reach ?? b.reach).toLowerCase())}`;
  const n = Math.max(1, Math.round(i.peopleCount));
  const mix = audienceCounts(i.units);
  // Nobody's audience known: the issue header's words for this app ("1 shopper"); one known, or a mix, as before.
  const asking = `${mix.length ? audienceCount(mix.length === 1 ? mix[0][0] : null, n, words) : peopleSayer(i)(n)} ${n === 1 ? "asks" : "ask"} for it`;
  const impact = i.type === "new_feature" ? asking
    : sev >= 5 ? `it blocks ${who}` : sev === 4 ? `${who} need a workaround` : sev === 3 ? `it slows ${who} down` : sev === 2 ? `it annoys ${who}` : `it's cosmetic for ${who}`;
  const band = fixBand(f.score);
  const fix = i.type === "new_feature"
    ? { Easy: "it looks quick to build", Moderate: "it's a moderate build", "Takes work": "it's a real build", Hard: "it's a large or unclear build" }[band]
    : { Easy: "the fix looks small", Moderate: "the fix is moderate", "Takes work": "the fix takes real work", Hard: "the fix is large or unclear" }[band];
  return `${u.word}: ${impact} ${where}, and ${fix}.`;
}

/** The whole reading, or null for an issue that hasn't been rated yet. */
export function analyseIssue(i: AnalysisInput, now: number): Analysis | null {
  const b = i.breakdown;
  if (!b || typeof b.severity !== "number") return null;
  const w = i.weights ?? DEFAULT_WEIGHTS;
  const u = urgency(i, b, now);
  const f = fixability(i, b, w);
  return { urgency: u, stakeholders: stakeholders(i, b, w), fixability: f, feeling: feeling(i.units), verdict: verdict(i, b, u, f) };
}

export type FlowLike = { board: string; title: string; frames: string[]; position: number };

/** The flow that holds most of these screens; ties go to the shorter flow, then canvas order (as pickFlow does). */
export function bestFlow<T extends FlowLike>(flows: T[], frameIds: string[]): T | null {
  const mine = new Set(frameIds);
  const overlap = (f: T) => f.frames.filter((x) => mine.has(x)).length;
  return flows.filter((f) => overlap(f) > 0).sort((a, z) => overlap(z) - overlap(a) || a.frames.length - z.frames.length || a.position - z.position)[0] ?? null;
}

/** How many flows show any of these screens. */
export const flowsWith = (flows: FlowLike[], frameIds: string[]) => flows.filter((f) => f.frames.some((x) => frameIds.includes(x))).length;

/**
 * Where the problem shows on its best flow: the most confident screen that's on it (a later step wins a tie), as
 * "Message thread, step 2 of 2 in Read a message". Null when none of the screens is on a flow.
 */
export function placeOnFlow<T extends FlowLike>(flows: T[], screens: { frame_id: string; title: string | null; confidence: number }[]): { flow: T; frame_id: string; step: number; total: number; text: string } | null {
  const flow = bestFlow(flows, screens.map((s) => s.frame_id));
  if (!flow) return null;
  const on = screens.filter((s) => flow.frames.includes(s.frame_id))
    .sort((a, z) => z.confidence - a.confidence || flow.frames.indexOf(z.frame_id) - flow.frames.indexOf(a.frame_id))[0];
  const step = flow.frames.indexOf(on.frame_id) + 1;
  const title = on.title ?? on.frame_id;
  // A screen most flows start from (Home) says little about one flow, so name it as the start of them all.
  const holding = flows.filter((f) => f.frames.includes(on.frame_id));
  const text = holding.length > 1 && holding.every((f) => f.frames[0] === on.frame_id)
    ? `${title}, where ${holding.length} flows start`
    : `${title}, step ${step} of ${flow.frames.length} in ${flow.title}`;
  return { flow, frame_id: on.frame_id, step, total: flow.frames.length, text };
}
