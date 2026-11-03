import { describe, it, expect } from "vitest";
import { agedChange, agedScore, aggregateSignals, countPeople, computeImportance, computeEase, explainImportance, priorityChangeSince, priorityReason, routeLane } from "@/lib/scoring";

describe("countPeople", () => {
  it("unions speakers and corroborators case-insensitively and adds half of reported counts", () => {
    expect(countPeople([
      { speakers: ["Alex Chen"], corroborators: ["Leah Brooks"], reportedCount: 0 },
      { speakers: ["alex chen "], corroborators: ["Omar Haddad"], reportedCount: 2 },
    ])).toBe(4); // alex, leah, omar = 3, + 0.5*2
  });
  it("returns 0 for no units", () => expect(countPeople([])).toBe(0));
});

describe("computeImportance", () => {
  it("scores the silent early-pickup failure high", () => {
    expect(computeImportance({ severity: 5, reach: 1, peopleCount: 1, meanSentiment: -2, frustrated: true, daysSinceLastReport: 0 })).toBe(86);
  });
  it("is bounded 0..100", () => {
    const v = computeImportance({ severity: 1, reach: 0, peopleCount: 0, meanSentiment: 0, frustrated: false, daysSinceLastReport: 365 });
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(5);
  });
});

describe("computeEase", () => {
  it("single-screen, clear, well-mapped fix is easy", () => {
    expect(computeEase({ scope: "single_screen", clarity: 5, mappingConfidence: 0.9 })).toBe(85);
  });
  it("unmapped issues lose the mapping component", () => {
    expect(computeEase({ scope: "single_screen", clarity: 5, mappingConfidence: 0 })).toBe(58);
  });
});

describe("routeLane", () => {
  it("important + easy bug is a quick win", () => expect(routeLane({ importance: 86, ease: 85, type: "bug", recentReports7d: 1 })).toBe("quick_win"));
  it("important + easy new feature is still explore", () => expect(routeLane({ importance: 70, ease: 90, type: "new_feature", recentReports7d: 1 })).toBe("explore"));
  it("important but hard is explore", () => expect(routeLane({ importance: 75, ease: 40, type: "add_on", recentReports7d: 1 })).toBe("explore"));
  it("mid importance and rising is watch", () => expect(routeLane({ importance: 50, ease: 90, type: "bug", recentReports7d: 2 })).toBe("watch"));
  it("mid importance, not rising is backlog", () => expect(routeLane({ importance: 50, ease: 90, type: "bug", recentReports7d: 1 })).toBe("backlog"));
  it("low importance is backlog", () => expect(routeLane({ importance: 20, ease: 99, type: "bug", recentReports7d: 9 })).toBe("backlog"));
});

describe("explainImportance", () => {
  const pickup = { severity: 5, reach: 1, peopleCount: 1, meanSentiment: -2, frustrated: true, daysSinceLastReport: 0 };
  it("splits the pickup score into points per factor that add up to the score", () => {
    const e = explainImportance(pickup);
    expect(e.total).toBe(86);
    expect(e.points).toEqual({ severity: 35, reach: 25, frequency: 6, intensity: 10, recency: 10 });
  });
  it("always adds up exactly to computeImportance", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 500; k++) {
      const i = { severity: 1 + Math.floor(rnd() * 5), reach: rnd(), peopleCount: Math.floor(rnd() * 20) / 2, meanSentiment: rnd() * 4 - 2, frustrated: rnd() > 0.5, daysSinceLastReport: rnd() * 90 };
      const e = explainImportance(i);
      expect(Object.values(e.points).reduce((a, b) => a + b, 0)).toBe(computeImportance(i));
      expect(e.total).toBe(computeImportance(i));
    }
  });
});

describe("aggregateSignals", () => {
  it("counts how many pieces of feedback carry each signal", () => {
    expect(aggregateSignals([
      { severity_signals: { blocks_task: true, has_workaround: true, data_loss: false, frequency_words: true } },
      { severity_signals: { blocks_task: true, has_workaround: false, data_loss: false, frequency_words: false } },
      { severity_signals: null },
    ])).toEqual({ blocks_task: 2, has_workaround: 1, data_loss: 0, frequency_words: 1, of: 3 });
  });
});

describe("priorityReason", () => {
  const base = { severity: 4, reach: 0.6, peopleCount: 3, meanSentiment: -1, frustrated: false, lastReportAt: "2026-10-10T00:00:00Z", distinctPeople: 3, reportedByOthers: 0 };
  it("names what moved the score", () => {
    expect(priorityReason(undefined, base)).toBe("First scored");
    expect(priorityReason(undefined, base, 86)).toBe("Re-rated with new feedback");
    expect(priorityReason(base, { ...base, peopleCount: 6, distinctPeople: 6, lastReportAt: "2026-10-15T00:00:00Z" })).toBe("3 more people");
    expect(priorityReason(base, { ...base, peopleCount: 4, distinctPeople: 4 })).toBe("1 more person");
    expect(priorityReason(base, { ...base, severity: 5 })).toBe("Rated more severe");
    expect(priorityReason(base, { ...base, peopleCount: 5, distinctPeople: 5, severity: 3 })).toBe("2 more people, rated less severe");
    expect(priorityReason(base, { ...base, reach: 0.9 })).toBe("Seen as more widespread");
    expect(priorityReason(base, { ...base, lastReportAt: "2026-10-15T00:00:00Z" })).toBe("New reports");
    expect(priorityReason(base, base)).toBe("Older reports count for less");
  });
});

describe("priorityChangeSince", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  const at = (h: number) => new Date(now - h * 3_600_000).toISOString();
  it("measures from the value the issue had 24 hours ago", () => {
    const history = [{ at: at(48), from: null, to: 40 }, { at: at(30), from: 40, to: 45 }, { at: at(5), from: 45, to: 52 }, { at: at(1), from: 52, to: 63 }];
    expect(priorityChangeSince(history, 63, now, 24 * 3_600_000)).toEqual({ from: 45, to: 63 });
  });
  it("uses the earliest change inside the window when nothing came before it", () => {
    expect(priorityChangeSince([{ at: at(10), from: 30, to: 50 }], 50, now, 24 * 3_600_000)).toEqual({ from: 30, to: 50 });
  });
  it("has no baseline for an issue first scored inside the window", () => {
    expect(priorityChangeSince([{ at: at(3), from: null, to: 70 }, { at: at(1), from: 70, to: 80 }], 80, now, 24 * 3_600_000)).toBeNull();
  });
  it("returns null without history", () => expect(priorityChangeSince([], 50, now, 24 * 3_600_000)).toBeNull());
});

describe("agedScore", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  const inputs = (daysAgo: number) => ({ severity: 4, reach: 0.6, peopleCount: 3, meanSentiment: -1, frustrated: false, distinctPeople: 3, reportedByOthers: 0, lastReportAt: new Date(now - daysAgo * 86_400_000).toISOString() });
  const issue = (daysAgo: number, importance: number) => ({ importance, ease: 80, type: "bug" as const, lane: "watch" as const, breakdown: { inputs: inputs(daysAgo) } });

  it("lowers priority as the last report gets older, with no new rating", () => {
    const fresh = explainImportance({ ...inputs(0), daysSinceLastReport: 0 }).total;
    const r = agedScore(issue(30, fresh), 0, now);
    expect(r!.importance).toBeLessThan(fresh);
    expect(Object.values(r!.points).reduce((a, b) => a + b, 0)).toBe(r!.importance);
  });
  it("moves a quiet issue out of Rising once its recent reports stop", () => {
    const mid = { ...issue(10, 49), breakdown: { inputs: { ...inputs(10), severity: 3, reach: 0.3 } } };
    const r = agedScore(mid, 0, now);
    expect(r!.importance).toBeGreaterThanOrEqual(35);
    expect(r!.importance).toBeLessThan(60);
    expect(r!.lane).toBe("backlog");
  });
  it("leaves issues without stored inputs, or with no change, alone", () => {
    expect(agedScore({ importance: 50, ease: 80, type: "bug", lane: "watch", breakdown: null }, 0, now)).toBeNull();
    const same = explainImportance({ ...inputs(2), daysSinceLastReport: 2 }).total;
    expect(agedScore({ ...issue(2, same), lane: routeLane({ importance: same, ease: 80, type: "bug", recentReports7d: 2 }) }, 2, now)).toBeNull();
  });
});

describe("agedChange", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  const prev = { id: "i1", importance: 70, lane: "watch" as const, score_breakdown: { inputs: { severity: 4 }, points: { severity: 1 } } };
  const points = { severity: 30, reach: 20, frequency: 10, intensity: 5, recency: 4 };

  it("stamps updated_at, so the board and the Slack sweep treat the issue as changed", () => {
    expect(agedChange(prev, { importance: 69, lane: "watch", points }, now).patch).toEqual({
      importance: 69, lane: "watch", score_breakdown: { inputs: { severity: 4 }, points }, updated_at: "2026-10-15T12:00:00.000Z",
    });
  });
  it("logs a priority move of 3 or more and any lane change, but not a small drift", () => {
    expect(agedChange(prev, { importance: 68, lane: "watch", points }, now).log).toEqual([]);
    expect(agedChange(prev, { importance: 67, lane: "backlog", points }, now).log).toEqual([
      { issue_id: "i1", kind: "priority_changed", payload: { from: 70, to: 67, reason: "Older reports count for less" } },
      { issue_id: "i1", kind: "lane_changed", payload: { from: "watch", to: "backlog" } },
    ]);
  });
});
