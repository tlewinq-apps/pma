// The full-flow pop-up's layout, kept pure so it can be tested: one step model for both a drawn flow and the mock-up's
// own shots, the step a clicked screen belongs to, and the screen sizes that fit the window. Every height the pop-up
// stacks around its screens is named here, so two rows and their captions always fit without scrolling.
import type { ParsedFrame } from "@/lib/marver/frame";
import type { FlowChange } from "@/lib/marver/flowModel";
import type { FlowColumn } from "@/lib/queries/flowView";

/** One of the mock-up's rendered screens: a before or after shot, or just a title when there is no shot. `contain`: the
 *  shot keeps its own shape (a screen drawn from an app's code may be a desktop window), so it is fitted, never cropped. */
export type Shot = { frame_id: string; title: string; url?: string | null; contain?: boolean };
export type Shots = { current: Shot[]; proposed: Shot[] };

/** One side of a step: a parsed Marver frame, a rendered shot, or neither (just a title). */
export type StepSide = { frame_id: string; title: string; frame?: ParsedFrame | null; url?: string | null; contain?: boolean };
/** One step of the flow, today's screen over the proposed one. `change` is null for shots, which don't know it. */
export type Step = {
  key: string;
  current: StepSide | null;
  proposed: (StepSide & { change: FlowChange | null; caption: string | null }) | null;
  /** What the person taps on the step before to get here, in each row. */
  tapCurrent: string | null; tapProposed: string | null;
};

export function stepsFromFlow(columns: FlowColumn[]): Step[] {
  return columns.map((c, k) => ({
    key: `${k}:${c.proposed?.frame_id ?? c.current?.frame_id ?? ""}`,
    current: c.current,
    proposed: c.proposed && { ...c.proposed, caption: c.proposed.caption || null },
    tapCurrent: c.tapCurrent, tapProposed: c.tapProposed,
  }));
}

/** The mock-up's shots paired by screen, the proposed ones first, with the mock-up's one line on what changed. */
export function stepsFromShots(shots: Shots, changed: Map<string, string | null> = new Map()): Step[] {
  const ids = [...new Set([...shots.proposed, ...shots.current].map((s) => s.frame_id))];
  return ids.map((id) => {
    const p = shots.proposed.find((s) => s.frame_id === id);
    return {
      key: id,
      current: shots.current.find((s) => s.frame_id === id) ?? null,
      proposed: p ? { ...p, change: null, caption: changed.get(id) || null } : null,
      tapCurrent: null, tapProposed: null,
    };
  });
}

/** The step showing screen `frameId`, looked for among the proposed screens first; null opens the overview instead. */
export function stepIndex(steps: Step[], frameId: string | null | undefined): number | null {
  if (!frameId) return null;
  const k = steps.findIndex((s) => s.proposed?.frame_id === frameId);
  const j = k >= 0 ? k : steps.findIndex((s) => s.current?.frame_id === frameId);
  return j >= 0 ? j : null;
}

const RATIO = 390 / 844;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The overview's fixed heights around its two rows of screens: body padding, the step name above, the gap between
 * the rows, and the two-line change and caption below. */
export const OVERVIEW = { padX: 32, padY: 24, topCaption: 24, rowGap: 20, bottomCaption: 44, gutter: 72, gapMin: 96, gapMax: 200, wMin: 96, wMax: 280 } as const;
export const OVERVIEW_CHROME_H = OVERVIEW.padY * 2 + OVERVIEW.topCaption + OVERVIEW.rowGap + OVERVIEW.bottomCaption;

/**
 * Screen width `w` for the overview: as tall as both rows allow, narrower when the steps don't fit across, and never
 * past `wMax`. Spare width goes to the gaps between steps (up to `gapMax`), then to margin. The row labels' gutter is
 * mirrored on the right so the screens sit in the window's centre. Below `wMin` the rows scroll sideways.
 */
export function fitOverview({ bodyW, bodyH, steps }: { bodyW: number; bodyH: number; steps: number }) {
  const n = Math.max(1, steps);
  const half = Math.floor((bodyH - OVERVIEW_CHROME_H) / 2);
  const across = bodyW - OVERVIEW.padX * 2 - OVERVIEW.gutter * 2;
  const byWidth = (across - (n - 1) * OVERVIEW.gapMin) / n;
  const w = Math.floor(clamp(Math.min(half * RATIO, byWidth), OVERVIEW.wMin, OVERVIEW.wMax));
  const gap = n > 1 ? Math.floor(clamp((across - n * w) / (n - 1), OVERVIEW.gapMin, OVERVIEW.gapMax)) : 0;
  return { w, h: Math.round(w / RATIO), gap, scrolls: byWidth < OVERVIEW.wMin };
}

/** The large view's fixed sizes: body padding, the label over each screen, the step strip below, the edge arrows, the
 * note beside the proposed screen (with its gap), and the room the note takes below the screens on a narrower window. */
export const DETAIL = { padX: 32, padY: 24, label: 24, strip: 72, arrow: 56, pair: 32, note: 280, noteBelow: 96, narrowPadX: 16, narrowPair: 12, wideMin: 200, wMin: 120, wMax: 390 } as const;

/**
 * Screen width for the large view: the two screens side by side, up to real size, as tall as the window allows. On a
 * wide window the pair sits in the exact centre, with the note and an arrow on one side mirrored by an arrow and the
 * same space on the other. When that would squeeze the screens under `wideMin`, the note moves below them instead.
 */
export function fitDetail({ bodyW, bodyH }: { bodyW: number; bodyH: number }) {
  const side = DETAIL.note + DETAIL.arrow;
  const byWidthWide = (bodyW - DETAIL.padX * 2 - DETAIL.pair - side * 2) / 2;
  const wide = byWidthWide >= DETAIL.wideMin;
  const byWidth = wide ? byWidthWide : (bodyW - DETAIL.narrowPadX * 2 - DETAIL.narrowPair) / 2;
  const byHeight = (bodyH - DETAIL.padY * 2 - DETAIL.label - DETAIL.strip - (wide ? 0 : DETAIL.noteBelow)) * RATIO;
  return { w: Math.floor(clamp(Math.min(byWidth, byHeight), DETAIL.wMin, DETAIL.wMax)), wide };
}
