// What the flow pop-up draws: today's flow over the proposed one, one column per step, with every frame parsed on the
// server (the client only receives plain trees) and the tap that leads from one step to the next.
import { gotoLabel, tryParseFrame, type ParsedFrame } from "@/lib/marver/frame";
import { flowState, flowSummary, type DraftFlow, type FlowChange } from "@/lib/marver/flowModel";
import { friendlyLlmError } from "@/lib/llm/errors";

export type FlowCell = { frame_id: string; title: string; frame: ParsedFrame | null };
export type FlowColumn = {
  current: FlowCell | null;
  proposed: (FlowCell & { change: FlowChange; caption: string }) | null;
  /** What the person taps on the step before to get here, in each row. */
  tapCurrent: string | null; tapProposed: string | null;
};
export type FlowView = {
  state: "drafting" | "ready" | "failed"; title: string; board: string | null; error: string | null;
  summary: string | null; imageUrl: string | null; canvasUrl: string | null; columns: FlowColumn[];
};

export function buildFlowView(f: DraftFlow, screens: Map<string, { title: string | null; source: string | null }>, now: number, canvasUrl: string | null): FlowView {
  const state = flowState(f, now) as FlowView["state"];
  const cell = (frame_id: string, source: string | null | undefined, title?: string): FlowCell => ({ frame_id, title: title || screens.get(frame_id)?.title || frame_id, frame: tryParseFrame(source) });
  // Before the plan lands, today's steps show with an empty proposed row.
  const plan = f.steps.length ? f.steps : f.current.map((c) => ({ current: c, frame_id: c, change: "same" as const, title: "", caption: "", source: undefined }));
  const columns: FlowColumn[] = plan.map((s) => ({
    current: s.current ? cell(s.current, screens.get(s.current)?.source) : null,
    proposed: f.steps.length
      ? { ...cell(s.frame_id, s.source ?? (s.change === "same" && s.current ? screens.get(s.current)?.source : null), s.title), change: s.change, caption: s.caption }
      : null,
    tapCurrent: null, tapProposed: null,
  }));
  let prevCurrent: FlowCell | null = null;
  for (const [k, c] of columns.entries()) {
    if (c.current) {
      c.tapCurrent = prevCurrent?.frame ? gotoLabel(prevCurrent.frame.root, c.current.frame_id) : null;
      prevCurrent = c.current;
    }
    const before = columns[k - 1]?.proposed;
    if (c.proposed && before?.frame) c.tapProposed = gotoLabel(before.frame.root, c.proposed.frame_id);
  }
  return {
    state, title: f.title, board: f.board, error: state === "failed" ? (f.error ? friendlyLlmError(f.error) : "The flow didn't finish in time.") : null,
    summary: f.steps.length && state === "ready" ? flowSummary(f.steps) : null, imageUrl: f.image_url ?? null, canvasUrl, columns,
  };
}
