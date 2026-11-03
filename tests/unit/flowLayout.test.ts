// The full-flow pop-up's layout: one step model for both a drawn flow and the mock-up's shots, finding the step a
// clicked screen belongs to, and the screen sizes that keep both rows and every caption inside the window.
import { describe, it, expect } from "vitest";
import { fitDetail, fitOverview, OVERVIEW_CHROME_H, stepIndex, stepsFromFlow, stepsFromShots, type Step } from "@/lib/marver/flowLayout";
import type { FlowColumn } from "@/lib/queries/flowView";

const H = (w: number) => Math.round((w * 844) / 390);

const columns: FlowColumn[] = [
  { current: { frame_id: "home", title: "Home", frame: null }, proposed: { frame_id: "home", title: "Home", frame: null, change: "same", caption: "" }, tapCurrent: null, tapProposed: null },
  { current: { frame_id: "week", title: "Calendar week", frame: null }, proposed: { frame_id: "slip", title: "Sign permission slip", frame: null, change: "changed", caption: "Adds the slip form" }, tapCurrent: "Museum trip", tapProposed: "Museum trip" },
  { current: null, proposed: { frame_id: "done", title: "Slip submitted", frame: null, change: "new", caption: "Confirms the slip" }, tapCurrent: null, tapProposed: "Submit slip" },
];

describe("stepsFromFlow", () => {
  it("keeps each column as a step, with its change, caption and taps", () => {
    const steps = stepsFromFlow(columns);
    expect(steps).toHaveLength(3);
    expect(steps[1].proposed).toMatchObject({ frame_id: "slip", change: "changed", caption: "Adds the slip form" });
    expect(steps[1].tapProposed).toBe("Museum trip");
    expect(steps[2].current).toBeNull();
  });

  it("reads an empty caption as none", () => {
    expect(stepsFromFlow(columns)[0].proposed?.caption).toBeNull();
  });
});

describe("stepsFromShots", () => {
  it("pairs today's and the proposed shots by screen, proposed order first, with the mock-up's line on what changed", () => {
    const steps = stepsFromShots(
      { current: [{ frame_id: "a", title: "A", url: "a0.png" }, { frame_id: "b", title: "B", url: "b0.png" }], proposed: [{ frame_id: "b", title: "B", url: "b1.png" }] },
      new Map([["b", "Moves the button up"]]),
    );
    expect(steps.map((s) => s.key)).toEqual(["b", "a"]);
    expect(steps[0].current?.url).toBe("b0.png");
    expect(steps[0].proposed).toMatchObject({ url: "b1.png", change: null, caption: "Moves the button up" });
    expect(steps[1].proposed).toBeNull();
  });
});

describe("stepIndex", () => {
  const steps: Step[] = stepsFromFlow(columns);
  it("finds a screen among the proposed ones first", () => expect(stepIndex(steps, "slip")).toBe(1));
  it("falls back to today's screens", () => expect(stepIndex(steps, "week")).toBe(1));
  it("is null for a screen not in the flow, or none", () => {
    expect(stepIndex(steps, "elsewhere")).toBeNull();
    expect(stepIndex(steps, null)).toBeNull();
  });
});

describe("fitOverview", () => {
  it.each([1030, 900, 700])("fits both rows and their captions in a body %ipx tall", (bodyH) => {
    const { w, scrolls } = fitOverview({ bodyW: 1900, bodyH, steps: 3 });
    expect(scrolls).toBe(false);
    expect(2 * H(w) + OVERVIEW_CHROME_H).toBeLessThanOrEqual(bodyH);
  });

  it("caps the screens and the gaps on a wide window, leaving the rest as margin to centre in", () => {
    const { w, gap } = fitOverview({ bodyW: 2400, bodyH: 2000, steps: 3 });
    expect(w).toBe(280);
    expect(gap).toBe(200);
  });

  it("widens the gaps before leaving empty space", () => {
    const { gap } = fitOverview({ bodyW: 1400, bodyH: 900, steps: 3 });
    expect(gap).toBeGreaterThan(96);
  });

  it("scrolls sideways once a long flow would shrink the screens past their floor", () => {
    const { w, scrolls } = fitOverview({ bodyW: 1280, bodyH: 900, steps: 12 });
    expect(w).toBe(96);
    expect(scrolls).toBe(true);
  });

  it("has no gap for a single step", () => expect(fitOverview({ bodyW: 1200, bodyH: 900, steps: 1 }).gap).toBe(0));
});

describe("fitDetail", () => {
  it("shows the screens at real size when there is room", () => {
    expect(fitDetail({ bodyW: 1900, bodyH: 1400 })).toEqual({ w: 390, wide: true });
  });

  it("fits the height on a short window", () => {
    const { w } = fitDetail({ bodyW: 1900, bodyH: 760 });
    expect(w).toBeLessThan(390);
    expect(H(w)).toBeLessThanOrEqual(760);
  });

  it("moves the note below the screens before it squeezes them", () => {
    const { w, wide } = fitDetail({ bodyW: 984, bodyH: 640 });
    expect(wide).toBe(false);
    expect(w).toBeGreaterThanOrEqual(150);
  });

  it("puts two screens side by side on a phone, with the note below", () => {
    const { w, wide } = fitDetail({ bodyW: 359, bodyH: 700 });
    expect(wide).toBe(false);
    expect(2 * w).toBeLessThanOrEqual(359);
    expect(w).toBeGreaterThanOrEqual(120);
  });
});
