// "Create full flow" for a mock-up, pure core: what is stored on drafts.flow and how to read it back. The database side
// is lib/actions/flow.ts; the agent that plans and draws it is lib/marver/agent.ts.

export type FlowChange = "same" | "changed" | "new";
/** One step of the proposed flow. `current` is the step it stands for in today's flow (null for a new screen). */
export type FlowStep = { current: string | null; frame_id: string; change: FlowChange; title: string; caption: string; source?: string | null };
export type DraftFlow = {
  status: "drafting" | "ready" | "failed";
  /** The Marver board it came from (flow-compare-with-a-friend), or null when it was built from the issue's own screens. */
  board: string | null;
  title: string;
  started_at: string;
  finished_at?: string;
  error?: string;
  by?: string | null;
  /** Current over proposed, as one PNG (posted to Slack). */
  image_url?: string | null;
  /** The board written into the local Marver canvas, when there is one. */
  canvas_board?: string | null;
  /** Today's steps, in order. */
  current: string[];
  /** The proposed steps, filled in once planned. */
  steps: FlowStep[];
};

/** A flow that hasn't finished in this long was lost (a function that ran out of time) and can be started again. */
export const FLOW_STALE_MS = 6 * 60_000;
export const FLOW_NEW_MAX = 2;

export function parseDraftFlow(v: unknown): DraftFlow | null {
  const f = v as Partial<DraftFlow> | null;
  if (!f || typeof f !== "object" || !["drafting", "ready", "failed"].includes(f.status as string) || typeof f.started_at !== "string") return null;
  return {
    status: f.status as DraftFlow["status"], board: typeof f.board === "string" ? f.board : null, title: typeof f.title === "string" ? f.title : "Flow",
    started_at: f.started_at, finished_at: f.finished_at, error: f.error, by: f.by ?? null, image_url: f.image_url ?? null, canvas_board: f.canvas_board ?? null,
    current: Array.isArray(f.current) ? f.current.filter((x): x is string => typeof x === "string") : [],
    steps: Array.isArray(f.steps) ? f.steps.filter((s): s is FlowStep => !!s && typeof s.frame_id === "string" && ["same", "changed", "new"].includes(s.change)) : [],
  };
}

export type FlowState = "none" | "drafting" | "ready" | "failed";
export function flowState(f: DraftFlow | null, now: number): FlowState {
  if (!f) return "none";
  if (f.status === "drafting" && now - Date.parse(f.started_at) > FLOW_STALE_MS) return "failed";
  return f.status;
}

/** "3 steps: 1 changed, 1 new", for Slack and the activity list. */
export function flowSummary(steps: Pick<FlowStep, "change">[]): string {
  const changed = steps.filter((s) => s.change === "changed").length;
  const fresh = steps.filter((s) => s.change === "new").length;
  const parts = [changed && `${changed} changed`, fresh && `${fresh} new`].filter(Boolean);
  return `${steps.length} ${steps.length === 1 ? "step" : "steps"}${parts.length ? `: ${parts.join(", ")}` : ""}`;
}

