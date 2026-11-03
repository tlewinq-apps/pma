import { describe, it, expect } from "vitest";
import { recencyFactor, reportStats, scoreUrgency, weekTrend, type ReportStats } from "@/lib/urgency";

const NOW = Date.parse("2026-10-16T10:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
/** Nothing in earlier weeks, then `n` reports this week. */
const quiet = (n: number) => [0, 0, 0, 0, 0, 0, 0, n];
/** Three reports a week, then a week at least twice that. */
const rising = (n: number) => [3, 3, 3, 3, 3, 3, 3, Math.max(6, n)];
const stats = (o: Partial<ReportStats>): ReportStats => ({ distinct30: 0, others30: 0, weekly: quiet(0), lastSignalAt: ago(1), ...o });

describe("scoreUrgency, the plan's table", () => {
  const rows: [string, number, Partial<ReportStats>, number, number][] = [
    ["(a) S5 crash, 1 reporter yesterday", 5, { distinct30: 1, weekly: quiet(1) }, 8.93, 9],
    ["(b) S4 workaround, 25 reporters this week", 4, { distinct30: 25, weekly: quiet(25) }, 8, 8],
    ["(b) the same with a trend", 4, { distinct30: 25, weekly: rising(25) }, 8, 8],
    ["(b′) the same at S3", 3, { distinct30: 25, weekly: quiet(25) }, 7, 7],
    ["(c) S1 typo, 60 reporters", 1, { distinct30: 60, weekly: quiet(60) }, 4, 4],
    ["S1 + 60 reporters + trend + 5,000 PostHog users", 1, { distinct30: 60, weekly: rising(60), phUsers30: 5000 }, 4, 4],
    ["S2 + 200 reporters + trend + 5,000 PostHog users", 2, { distinct30: 200, weekly: rising(200), phUsers30: 5000 }, 6, 6],
    ["S5, 2 reporters", 5, { distinct30: 2, weekly: quiet(2) }, 9.19, 9],
    ["S5, 1 reporter + \"2 others said\"", 5, { distinct30: 1, others30: 2, weekly: quiet(1) }, 9.19, 9],
    ["S5, 1 reporter + 300 PostHog users", 5, { distinct30: 1, weekly: quiet(1), phUsers30: 300 }, 9.67, 10],
    ["S5, 1 reporter 16 days ago", 5, { distinct30: 1, lastSignalAt: ago(16) }, 8.49, 8],
    ["S5, 1 reporter 20 days ago", 5, { distinct30: 1, lastSignalAt: ago(20) }, 7.59, 8],
    ["S5, no reports for 31 days", 5, { lastSignalAt: ago(31) }, 4.89, 5],
    ["S4, 1 reporter", 4, { distinct30: 1, weekly: quiet(1) }, 5.87, 6],
    ["S4, 5 reporters", 4, { distinct30: 5, weekly: quiet(5) }, 7.24, 7],
    ["S3, no reports for 40 days", 3, { lastSignalAt: ago(40) }, 1.5, 2],
  ];
  it.each(rows)("%s", (_case, severity, s, raw, shown) => {
    const u = scoreUrgency(severity, stats(s), NOW);
    expect(u.raw).toBeCloseTo(raw, 2);
    expect(u.score).toBe(shown);
  });

  it("really applies the trend in the trend rows", () => {
    expect(scoreUrgency(4, stats({ distinct30: 25, weekly: rising(25) }), NOW).rising).toBe(1);
    expect(scoreUrgency(1, stats({ distinct30: 60, weekly: rising(60), phUsers30: 5000 }), NOW).rising).toBe(1);
  });
});

describe("scoreUrgency", () => {
  it("ranks a fresh crash above a workaround many reported, above a typo even more reported", () => {
    const crash = scoreUrgency(5, stats({ distinct30: 1, weekly: quiet(1) }), NOW);
    const workaround = scoreUrgency(4, stats({ distinct30: 25, weekly: quiet(25) }), NOW);
    const typo = scoreUrgency(1, stats({ distinct30: 60, weekly: quiet(60) }), NOW);
    expect(crash.raw).toBeGreaterThan(workaround.raw);
    expect(workaround.raw).toBeGreaterThan(typo.raw);
  });

  it("keeps a cosmetic issue out of Urgent whatever the numbers", () => {
    expect(scoreUrgency(1, stats({ distinct30: 10_000, others30: 10_000, weekly: rising(500), phUsers30: 1e6, lastSignalAt: ago(0) }), NOW).score).toBe(4);
  });

  it("puts a fresh blocker straight into Urgent, even with nobody named", () => {
    expect(scoreUrgency(5, stats({ lastSignalAt: ago(0) }), NOW).score).toBe(9);
  });

  it("lifts a rising issue by 0.15 of its band", () => {
    const u = scoreUrgency(4, stats({ distinct30: 1, weekly: [0, 0, 0, 0, 1, 1, 1, 3] }), NOW);
    expect(u.rising).toBe(1);
    expect(u.raw).toBeCloseTo(5 + 3 * (1 / Math.log2(11) + 0.15), 6);
  });

  it("counts PostHog users alongside reporters without double counting", () => {
    expect(scoreUrgency(4, stats({ phUsers30: 500 }), NOW).raw).toBeCloseTo(5 + 3 * 0.75, 6);
    expect(scoreUrgency(4, stats({ distinct30: 10, phUsers30: 500 }), NOW).raw).toBe(8);
  });

  it("treats an issue with no known report as fully faded", () => {
    expect(scoreUrgency(5, stats({ lastSignalAt: null }), NOW).raw).toBe(4.25);
  });

  it("reads a fractional severity at its nearest band and keeps it within 1 to 5", () => {
    const s = stats({ distinct30: 1 });
    expect(scoreUrgency(4.6, s, NOW).raw).toBe(scoreUrgency(5, s, NOW).raw);
    expect(scoreUrgency(9, s, NOW).raw).toBe(scoreUrgency(5, s, NOW).raw);
    expect(scoreUrgency(0, s, NOW).raw).toBe(scoreUrgency(1, s, NOW).raw);
  });

  it("says how many people it counted, others at half", () => {
    expect(scoreUrgency(3, stats({ distinct30: 2, others30: 3 }), NOW).people).toBe(3.5);
  });
});

describe("recencyFactor", () => {
  it("holds for two weeks, then fades to half over the next 40 days", () => {
    expect([0, 14, 15, 16, 20, 34, 54, 100].map(recencyFactor)).toEqual([1, 1, 0.975, 0.95, 0.85, 0.5, 0.5, 0.5]);
  });
});

describe("weekTrend", () => {
  it("is 1 when this week is at least twice the usual week", () => expect(weekTrend([0, 0, 0, 0, 2, 2, 2, 4]).t).toBe(1));
  it("is 0.5 at one and a half times", () => expect(weekTrend([0, 0, 0, 0, 2, 2, 2, 3]).t).toBe(0.5));
  it("takes the median earlier week as usual", () => expect(weekTrend([1, 1, 9, 9, 1, 1, 1, 3])).toEqual({ t: 1, thisWeek: 3, usual: 1 }));
  it("needs at least 3 reports this week", () => expect(weekTrend([0, 0, 0, 0, 1, 1, 1, 2]).t).toBe(0));
  it("needs 3 weeks of history before this one", () => expect(weekTrend([0, 0, 0, 0, 0, 1, 1, 6]).t).toBe(0));
  it("counts an old issue waking up after quiet weeks", () => expect(weekTrend([1, 0, 0, 0, 0, 0, 0, 3]).t).toBe(1));
  it("is 0 with no weeks at all", () => expect(weekTrend([]).t).toBe(0));
});

describe("reportStats", () => {
  const unit = (at: string, speakers: string[], o: { corroborators?: string[]; reportedCount?: number } = {}) =>
    ({ at, speakers, corroborators: o.corroborators ?? [], reportedCount: o.reportedCount ?? 0 });

  it("counts each named person once over the last 30 days, by when it happened", () => {
    const s = reportStats([
      unit(ago(1), ["Priya"]),
      unit(ago(2), ["priya ", "Tom"], { corroborators: ["Elena"], reportedCount: 2 }),
      unit(ago(45), ["Sam"], { reportedCount: 5 }),
    ], NOW);
    expect(s).toMatchObject({ distinct30: 3, others30: 2, lastSignalAt: ago(1), phUsers30: 0 });
  });

  it("buckets reports into 8 weeks, oldest first, this week last", () => {
    const s = reportStats([ago(0.5), ago(6.9), ago(7.1), ago(20), ago(55), ago(57), ago(-1)].map((at) => unit(at, ["A"])), NOW);
    expect(s.weekly).toEqual([1, 0, 0, 0, 0, 1, 1, 3]);
  });

  it("keeps the latest report even past 30 days, and has none with no pieces", () => {
    expect(reportStats([unit(ago(40), ["A"])], NOW)).toMatchObject({ distinct30: 0, lastSignalAt: ago(40) });
    expect(reportStats([], NOW)).toEqual({ distinct30: 0, others30: 0, weekly: quiet(0), lastSignalAt: null, phUsers30: 0 });
  });

  it("skips pieces with no readable date and passes PostHog users through", () => {
    expect(reportStats([unit("not a date", ["A"])], NOW, 12)).toMatchObject({ distinct30: 0, lastSignalAt: null, phUsers30: 12 });
  });
});
