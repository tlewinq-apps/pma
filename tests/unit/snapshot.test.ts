import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildSnapshot, datedFromToday, demoAlertRules, DEMO_SPAN_DAYS, EXTRA_SOURCES, WAITING_ON_FIRST_STEP, type DemoSource } from "../../scripts/demo/snapshot";
import { reportStats, scoreUrgency } from "../../src/lib/urgency";
import { URGENT_FROM } from "../../src/components/triage/views";
import { SCREENS } from "../../scripts/demo/celeste";

const sources = [...(JSON.parse(readFileSync("eval/fixtures/sources.json", "utf8")) as DemoSource[]), ...EXTRA_SOURCES];
const snap = buildSnapshot(sources);

describe("demo snapshot", () => {
  it("leaves exactly one issue of each type waiting on its first step, and finishes it on the rest", () => {
    const waiting = snap.issues.filter((i) => !i.diagnosis);
    expect(waiting.map((i) => i.key).sort()).toEqual([...WAITING_ON_FIRST_STEP].sort());
    expect(new Set(waiting.map((i) => i.type))).toEqual(new Set(["bug", "new_feature", "add_on", "streamline"]));
    for (const i of snap.issues.filter((x) => x.diagnosis)) {
      expect(i.diagnosis!.status).toBe("done");
      expect(i.diagnosis!.finding!.headline.length).toBeGreaterThan(10);
      if (i.type !== "bug") expect(i.diagnosis!.finding!.facts).toHaveLength(2);
    }
    // The ones waiting have screens and proposals on file, so a run without a model key still ends in proposals.
    for (const i of waiting) { expect(i.screens.length).toBeGreaterThan(0); expect(i.solutions.length).toBeGreaterThan(0); }
  });

  it("aligns every quote to its source text", () => {
    for (const u of [...snap.issues.flatMap((i) => i.units), ...snap.praise]) {
      const src = sources.find((s) => s.id === u.source)!;
      expect(src.raw_text.slice(u.span_start, u.span_end)).toBe(u.quote);
    }
  });

  it("routes issues across all four lanes", () => {
    const lanes = new Set(snap.issues.map((i) => i.lane));
    expect(lanes).toEqual(new Set(["quick_win", "explore", "watch", "backlog"]));
    expect(snap.issues.find((i) => i.key === "birth-time-reset")!.lane).toBe("quick_win");
  });

  it("gives explore issues three options with exactly one recommended, and quick wins one", () => {
    for (const i of snap.issues) {
      if (i.lane === "explore") expect(i.solutions).toHaveLength(3);
      if (i.lane === "quick_win") expect(i.solutions).toHaveLength(1);
      if (i.solutions.length) expect(i.solutions.filter((s) => s.recommended)).toHaveLength(1);
    }
  });

  it("includes new feature requests, each with three proposals", () => {
    const features = snap.issues.filter((i) => i.type === "new_feature");
    expect(features.length).toBeGreaterThanOrEqual(2);
    for (const i of features) expect(i.solutions).toHaveLength(3);
  });

  it("only references known screens", () => {
    const known = new Set(SCREENS.map((s) => s.frame_id));
    for (const f of [...snap.issues.flatMap((i) => i.screens), ...snap.praise.flatMap((p) => p.screens)]) expect(known.has(f.frame_id)).toBe(true);
    for (const s of snap.issues.flatMap((i) => i.solutions).flatMap((s) => s.target_frames)) expect(known.has(s)).toBe(true);
  });
});

describe("demo snapshot priority explanation", () => {
  it("stores the same breakdown the pipeline does, with points that add up to the priority", () => {
    for (const i of snap.issues) {
      const b = i.breakdown as { inputs: { lastReportAt: string; distinctPeople: number }; points: Record<string, number>; signals: { of: number } };
      expect(Object.values(b.points).reduce((a, n) => a + n, 0), i.key).toBe(i.importance);
      expect(b.inputs.distinctPeople).toBeGreaterThan(0);
      expect(Date.parse(b.inputs.lastReportAt)).not.toBeNaN();
      expect(b.signals.of).toBe(i.units.length);
    }
  });
});

describe("demo feedback dated relative to today", () => {
  const DAY = 86_400_000;
  const urgencyOn = (now: number) => {
    const dated = datedFromToday(sources, now);
    const at = new Map(dated.map((s) => [s.id, s.occurred_at]));
    return (key: string) => {
      const i = snap.issues.find((x) => x.key === key)!;
      const units = i.units.map((u) => ({ at: at.get(u.source)!, speakers: u.speakers, corroborators: u.corroborators ?? [], reportedCount: u.reported_count ?? 0 }));
      return scoreUrgency(i.rubric.severity, reportStats(units, now), now).score;
    };
  };

  it("keeps the story's order and puts all of it inside the last fortnight, whenever it is seeded", () => {
    for (const now of [Date.parse("2026-10-17T09:00:00Z"), Date.parse("2027-03-02T18:30:00Z")]) {
      const dated = datedFromToday(sources, now);
      const order = (xs: DemoSource[]) => [...xs].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at)).map((s) => s.id);
      expect(order(dated)).toEqual(order(sources));
      for (const s of dated) {
        expect(Date.parse(s.occurred_at)).toBeLessThanOrEqual(now);
        expect(now - Date.parse(s.occurred_at)).toBeLessThanOrEqual(DEMO_SPAN_DAYS * DAY + 1);
      }
    }
  });

  it("leaves the birth time bug and the restore purchase bug in the Urgent rail on a fresh seed", () => {
    const urgency = urgencyOn(Date.parse("2027-03-02T18:30:00Z"));
    expect(urgency("birth-time-reset")).toBeGreaterThanOrEqual(URGENT_FROM);
    expect(urgency("restore-purchase")).toBeGreaterThanOrEqual(URGENT_FROM);
  });
});

describe("demo alert rules", () => {
  it("alerts every member on a project with no rules, with the jump set low enough for the community-call sample", () => {
    expect(demoAlertRules(null, ["u1", "u2"])).toEqual({ recipients: ["u1", "u2"], blockingBug: true, jump: { enabled: true, points: 8 }, digest: { enabled: true } });
    expect(demoAlertRules({}, ["u1"]).recipients).toEqual(["u1"]);
  });
  it("keeps the choices made in Settings but resets the jump, so a re-seed always demos the jump alert", () => {
    const set = { recipients: ["u2"], blockingBug: false, jump: { enabled: false, points: 15 }, digest: { enabled: false } };
    expect(demoAlertRules(set, ["u1", "u2"])).toEqual({ recipients: ["u2"], blockingBug: false, jump: { enabled: true, points: 8 }, digest: { enabled: false } });
    expect(demoAlertRules({ ...set, recipients: [] }, ["u1"]).recipients).toEqual([]);
  });
});
