// Flows from the Marver canvas. A flow is a board at design/boards/flow-<name>.json whose nodes are the steps in order
// (left to right on the canvas). Marver shows the board; PMA reads it to lay out a journey and to pick the flow a
// proposal changes.
import type { DesignReader } from "./reader";

export type FlowBoard = { board: string; title: string; description: string | null; frames: string[]; position: number };

const FLOW_FILE = /(?:^|\/)(flow-[a-z0-9][a-z0-9-]*)\.json$/;
const titleOf = (board: string) => { const s = board.replace(/^flow-/, "").replace(/-/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };

/** A flow board, or null when the file isn't one. Steps follow the nodes' x position when every node has one. */
export function parseFlowBoard(path: string, json: unknown): FlowBoard | null {
  const board = path.match(FLOW_FILE)?.[1];
  const b = json as { title?: unknown; description?: unknown; order?: unknown; nodes?: unknown } | null;
  if (!board || !b || !Array.isArray(b.nodes)) return null;
  const nodes = (b.nodes as { frame?: unknown; x?: unknown }[]).filter((n): n is { frame: string; x?: unknown } => typeof n?.frame === "string");
  const placed = nodes.every((n) => typeof n.x === "number");
  const ordered = placed ? [...nodes].sort((a, z) => (a.x as number) - (z.x as number)) : nodes;
  const frames = ordered.map((n) => n.frame);
  if (!frames.length) return null;
  return {
    board, frames,
    title: typeof b.title === "string" && b.title.trim() ? b.title.trim() : titleOf(board),
    description: typeof b.description === "string" ? b.description : null,
    position: typeof b.order === "number" ? b.order : 0,
  };
}

/** Every flow board in the canvas, keeping only steps that are known screens and flows of two steps or more. */
export async function readFlowBoards(reader: DesignReader, designPath: string, known: Set<string>): Promise<FlowBoard[]> {
  const out: FlowBoard[] = [];
  for (const path of (await reader.list(`${designPath}/boards`)).filter((p) => FLOW_FILE.test(p)).sort()) {
    const raw = await reader.read(path);
    if (!raw) continue;
    let json: unknown;
    try { json = JSON.parse(raw); } catch { continue; } // a half-written board shouldn't stop the sync
    const b = parseFlowBoard(path, json);
    if (!b) continue;
    const frames = b.frames.filter((f) => known.has(f));
    if (frames.length >= 2) out.push({ ...b, frames });
  }
  return out;
}

/**
 * The flow a proposal changes: one that contains its end-result screen, preferring the most overlap with the issue's
 * screens, then the shorter flow, then the canvas order. Null when no flow contains that screen.
 */
export function pickFlow<T extends Pick<FlowBoard, "frames" | "position">>(flows: T[], endFrame: string, issueFrames: string[]): T | null {
  const mine = new Set(issueFrames);
  const overlap = (f: T) => f.frames.filter((x) => mine.has(x)).length;
  return flows.filter((f) => f.frames.includes(endFrame))
    .sort((a, z) => overlap(z) - overlap(a) || a.frames.length - z.frames.length || a.position - z.position)[0] ?? null;
}
