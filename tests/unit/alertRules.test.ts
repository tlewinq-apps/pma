import { describe, it, expect } from "vitest";
import { DEFAULT_ALERT_RULES, alertKey, alertsFor, isBlockingBug, parseAlertRules } from "@/lib/alerts/rules";

const now = Date.parse("2026-10-15T12:00:00Z");
const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();
const signals = (blocks: number, of = 3) => ({ blocks_task: blocks, has_workaround: 0, data_loss: 0, frequency_words: 0, of });

describe("parseAlertRules", () => {
  it("fills defaults for anything missing or malformed", () => {
    expect(parseAlertRules(null)).toEqual(DEFAULT_ALERT_RULES);
    expect(parseAlertRules({ recipients: ["u1", 7], jump: { points: "x" }, digest: { enabled: false } })).toEqual({ ...DEFAULT_ALERT_RULES, recipients: ["u1"], digest: { enabled: false } });
    expect(parseAlertRules({ jump: { enabled: false, points: 8 }, blockingBug: false })).toMatchObject({ jump: { enabled: false, points: 8 }, blockingBug: false });
  });
  it("keeps the jump size in a sensible range", () => {
    expect(parseAlertRules({ jump: { points: 0 } }).jump.points).toBe(1);
    expect(parseAlertRules({ jump: { points: 500 } }).jump.points).toBe(100);
  });
});

describe("isBlockingBug", () => {
  it("is a bug that someone says blocks them, or that is rated as blocking", () => {
    expect(isBlockingBug("bug", 3, signals(1))).toBe(true);
    expect(isBlockingBug("bug", 5, signals(0))).toBe(true);
    expect(isBlockingBug("bug", 4, signals(0))).toBe(false);
    expect(isBlockingBug("add_on", 5, signals(2))).toBe(false);
    expect(isBlockingBug("bug", 3, null)).toBe(false);
  });
});

describe("alertKey", () => {
  it("dedupes a blocking bug once ever, a jump once a day, and the digest once a day", () => {
    expect(alertKey.blocking("i1")).toBe("blocking:i1");
    expect(alertKey.jump("i1", now)).toBe("jump:i1:2026-10-15");
    expect(alertKey.digest(now)).toBe("digest:2026-10-15");
    expect(alertKey.shipped("i1", "s1")).toBe("shipped:i1:s1");
  });
});

describe("alertsFor", () => {
  const base = { issueId: "i1", type: "bug" as const, severity: 3, signals: signals(0), now, rules: DEFAULT_ALERT_RULES, wasBlocking: false as boolean | null, isNew: false };

  it("flags a new blocking bug", () => {
    const a = alertsFor({ ...base, isNew: true, signals: signals(2), next: 64, history: [{ at: hoursAgo(0), from: null, to: 64 }] });
    expect(a).toEqual([{ rule: "blocking_bug", key: "blocking:i1", detail: { priority: 64, new: true } }]);
  });
  it("flags a bug that has just started blocking people, but not one that already did or whose past is unknown", () => {
    const now2 = { ...base, signals: signals(1), next: 64, history: [] };
    expect(alertsFor({ ...now2, wasBlocking: false })).toEqual([{ rule: "blocking_bug", key: "blocking:i1", detail: { priority: 64, new: false } }]);
    expect(alertsFor({ ...now2, wasBlocking: true })).toEqual([]);
    expect(alertsFor({ ...now2, wasBlocking: null })).toEqual([]);
  });

  it("flags a jump of the set size within a day, measured from where it stood a day ago", () => {
    const history = [{ at: hoursAgo(48), from: null, to: 40 }, { at: hoursAgo(1), from: 40, to: 58 }];
    expect(alertsFor({ ...base, next: 58, history })).toEqual([{ rule: "jump", key: "jump:i1:2026-10-15", detail: { from: 40, to: 58 } }]);
    expect(alertsFor({ ...base, next: 52, history: [{ at: hoursAgo(48), from: null, to: 40 }, { at: hoursAgo(1), from: 40, to: 52 }] })).toEqual([]);
  });

  it("alerts on one jump once, even if a rescore after UTC midnight sees the same rise", () => {
    const history = [{ at: hoursAgo(48), from: null, to: 40 }, { at: hoursAgo(3), from: 40, to: 58 }];
    expect(alertsFor({ ...base, next: 58, history, lastJumpAt: now - 3 * 3_600_000 })).toEqual([]);
    expect(alertsFor({ ...base, next: 58, history, lastJumpAt: now - 25 * 3_600_000 })).toHaveLength(1);
  });

  it("never treats a brand-new issue as a jump", () => {
    expect(alertsFor({ ...base, next: 80, history: [{ at: hoursAgo(1), from: null, to: 80 }] })).toEqual([]);
  });

  it("respects switched-off rules and the chosen jump size", () => {
    const history = [{ at: hoursAgo(48), from: null, to: 40 }, { at: hoursAgo(1), from: 40, to: 50 }];
    expect(alertsFor({ ...base, next: 50, history, rules: { ...DEFAULT_ALERT_RULES, jump: { enabled: true, points: 10 } } })).toHaveLength(1);
    expect(alertsFor({ ...base, next: 50, history, rules: { ...DEFAULT_ALERT_RULES, jump: { enabled: false, points: 10 } } })).toEqual([]);
    expect(alertsFor({ ...base, signals: signals(1), next: 50, history: [], rules: { ...DEFAULT_ALERT_RULES, blockingBug: false } })).toEqual([]);
  });
});
