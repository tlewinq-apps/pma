// The Flows tab: each Marver flow as a row of real screens with the tap between steps, and what open issues and praise
// say about each screen.
import { describe, it, expect } from "vitest";
import { FIXTURE_DESIGN } from "@/lib/marver/fixture.generated";
import { buildJourneys, screenNotes } from "@/components/flows/journey";

const src = (id: string) => FIXTURE_DESIGN[`design/scenes/${id}.tsx`];
const screen = (id: string, title: string) => ({ id: `s-${id}`, frame_id: id, title, source: src(id) });
const SCREENS = [screen("today/index", "Today"), screen("friends/list", "Friends"), screen("compatibility/match", "Compatibility"), screen("settings/notifications", "Notifications")];
const issue = (screen_id: string, id: string, status: string, severity?: number, nested = false) =>
  ({ screen_id, issues: { id, status, score_breakdown: severity == null ? null : nested ? { inputs: { severity } } : { severity } } });

describe("screenNotes", () => {
  it("counts open issues once each, keeps the worst severity and counts praise", () => {
    const notes = screenNotes(
      [issue("s-a", "i1", "new", 2), issue("s-a", "i1", "new", 2), issue("s-a", "i2", "in_review", 4, true), issue("s-a", "i3", "shipped", 5), issue("s-a", "i4", "dismissed", 5), issue("s-b", "i5", "new")],
      [{ screen_id: "s-a" }, { screen_id: "s-a" }, { screen_id: "s-c" }],
    );
    expect(notes.get("s-a")).toEqual({ issues: 2, severity: 4, praise: 2 });
    expect(notes.get("s-b")).toEqual({ issues: 1, severity: null, praise: 0 });
    expect(notes.get("s-c")).toEqual({ issues: 0, severity: null, praise: 1 });
  });
});

describe("buildJourneys", () => {
  const flows = [
    { board: "flow-reading", title: "Reading", description: null, frames: ["today/index", "compatibility/match"], position: 2 },
    { board: "flow-compare-with-a-friend", title: "Compare with a friend", description: "Opening a compatibility reading.", frames: ["today/index", "friends/list", "compatibility/match", "gone/missing"], position: 1 },
  ];
  const notes = screenNotes([issue("s-friends/list", "i1", "new", 5)], []);
  const { journeys, others } = buildJourneys(flows, SCREENS, notes, (b) => `http://canvas/#/b/${b}`);

  it("lays out each flow in canvas order with the tap that leads to the next step", () => {
    expect(journeys.map((j) => j.board)).toEqual(["flow-compare-with-a-friend", "flow-reading"]);
    const compare = journeys[0];
    expect(compare.canvasUrl).toBe("http://canvas/#/b/flow-compare-with-a-friend");
    expect(compare.steps.map((s) => s.frame_id)).toEqual(["today/index", "friends/list", "compatibility/match"]);
    expect(compare.steps.map((s) => s.tap)).toEqual([null, "Compare with a friend", "Leo Martins"]);
    expect(compare.steps.every((s) => s.frame)).toBe(true);
    expect(compare.steps[1].note).toEqual({ issues: 1, severity: 5, praise: 0 });
    expect(compare.steps[0].note).toEqual({ issues: 0, severity: null, praise: 0 });
  });
  it("puts screens on no flow under other screens, and draws what it can't parse as a title", () => {
    expect(others.map((s) => s.frame_id)).toEqual(["settings/notifications"]);
    const broken = buildJourneys([], [{ id: "x", frame_id: "a/b", title: null, source: "not tsx" }], new Map(), () => null);
    expect(broken.others[0]).toMatchObject({ frame_id: "a/b", title: "a/b", frame: null });
  });
});
