// Urgency out of 10, pure: severity sets a band, how many people it reached moves the score within that band, a
// rising week lifts it, and quiet time fades it. So a crash one person reported yesterday ranks above a workaround 25
// people reported this week, which ranks above a typo 60 people mentioned, and a cosmetic issue never reaches Urgent.
// The Desk badge, Why it matters and the Urgent rail all read it, so they always agree.
import { peopleParts } from "./scoring";

/**
 * What urgency counts. Built from the issue's pieces of feedback for now (reportStats); deduped reporter counts can
 * fill the same shape later.
 */
export type ReportStats = {
  /** Distinct people who reported it in the last 30 days, by when the feedback happened. */
  distinct30: number;
  /** People they reported for ("2 others said") in the last 30 days, counted at half. */
  others30: number;
  /** Reports per week, oldest first; the last is the 7 days up to now. */
  weekly: number[];
  /** The latest report or PostHog event; null when none is known. */
  lastSignalAt: string | null;
  /** PostHog distinct users on linked errors and rage clicks in the last 30 days. */
  phUsers30?: number;
};

export type Trend = 0 | 0.5 | 1;
export type Urgency = {
  /** A whole number out of 10, as the Desk badge and Why it matters show it. */
  score: number;
  /** Before rounding, to sort issues that show the same number. */
  raw: number;
  /** People counted: the distinct ones plus half the others they mentioned. */
  people: number;
  /** 1 when this week is at least twice the usual week, 0.5 at one and a half times. */
  rising: Trend;
};

/** Where each severity can land: low with nobody counted, high once reach saturates. */
export const URGENCY_BANDS: Record<1 | 2 | 3 | 4 | 5, readonly [number, number]> = { 1: [1, 4], 2: [2, 6], 3: [3, 7], 4: [5, 8], 5: [8.5, 10] };
/** Weeks of history the trend looks at, this week included. */
export const WEEKS = 8;
const DAY = 86_400_000;
/** As faded as a quiet issue gets: half its score. */
const FADED = 0.5;

/** 0..1 on a log scale that reaches 1 at `full` (the same saturation priority uses for people). */
const saturate = (n: number, full: number) => Math.min(1, Math.log2(1 + Math.max(0, n)) / Math.log2(1 + full));
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Full strength for two weeks after the latest report, then fading to half over the next 40 days. */
export function recencyFactor(days: number): number {
  return days <= 14 ? 1 : Math.max(FADED, 1 - (days - 14) / 40);
}

/**
 * Whether this week is busier than usual. Usual is the median of the earlier weeks since the first report; it takes at
 * least 3 reports this week and 3 earlier weeks of history, so a brand new issue isn't "rising" by default.
 */
export function weekTrend(weekly: number[]): { t: Trend; thisWeek: number; usual: number } {
  const thisWeek = weekly.at(-1) ?? 0;
  const first = weekly.findIndex((n) => n > 0);
  const prior = first < 0 ? [] : weekly.slice(first, -1);
  const usual = median(prior);
  if (prior.length < 3 || thisWeek < 3) return { t: 0, thisWeek, usual };
  return { t: thisWeek >= 2 * usual ? 1 : thisWeek >= 1.5 * usual ? 0.5 : 0, thisWeek, usual };
}

export function scoreUrgency(severity: number, s: ReportStats, now: number): Urgency {
  const [lo, hi] = URGENCY_BANDS[Math.min(5, Math.max(1, Math.round(severity))) as 1 | 2 | 3 | 4 | 5];
  const people = s.distinct30 + 0.5 * s.others30;
  const reach = saturate(people, 10);
  const ph = saturate(s.phUsers30 ?? 0, 500);
  // Either signal lifts it; a person who both reported it and shows in PostHog isn't counted twice.
  const f = 1 - (1 - reach) * (1 - 0.75 * ph);
  const rising = weekTrend(s.weekly).t;
  const g = Math.min(1, f + 0.15 * rising);
  const last = s.lastSignalAt ? Date.parse(s.lastSignalAt) : NaN;
  const r = Number.isFinite(last) ? recencyFactor(Math.max(0, (now - last) / DAY)) : FADED;
  const raw = (lo + (hi - lo) * g) * r;
  return { score: Math.round(raw), raw, people, rising };
}

/** A piece of feedback as the stats read it: when it happened and who said it. */
export type StatsUnit = { at: string; speakers: string[]; corroborators?: string[]; reportedCount?: number };

/**
 * ReportStats from the issue's pieces: people counted as priority counts them (peopleParts), over pieces from the last
 * 30 days, plus reports per week. Pieces dated in the future count as this week.
 */
export function reportStats(units: StatsUnit[], now: number, phUsers30 = 0): ReportStats {
  const dated = units.map((u) => ({ u, t: Date.parse(u.at) })).filter((x) => Number.isFinite(x.t));
  const recent = peopleParts(dated.filter((x) => now - x.t <= 30 * DAY)
    .map(({ u }) => ({ speakers: u.speakers, corroborators: u.corroborators ?? [], reportedCount: u.reportedCount ?? 0 })));
  const weekly = Array<number>(WEEKS).fill(0);
  for (const { t } of dated) {
    const back = Math.max(0, Math.floor((now - t) / (7 * DAY)));
    if (back < WEEKS) weekly[WEEKS - 1 - back] += 1;
  }
  const latest = dated.reduce((m, x) => Math.max(m, x.t), -Infinity);
  return { distinct30: recent.distinct, others30: recent.reported, weekly, lastSignalAt: dated.length ? new Date(latest).toISOString() : null, phUsers30 };
}
