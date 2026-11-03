// The Flows tab, pure core: each flow board on the Marver canvas as a row of real screens, the tap that leads from one
// step to the next, and what open issues and praise say about each screen. Frames are parsed here, on the server, so
// the page only draws plain trees. The flows page loads the rows; FlowList draws them.
import { gotoLabel, tryParseFrame, type ParsedFrame } from "@/lib/marver/frame";

export type ScreenNote = { issues: number; severity: number | null; praise: number };
export type JourneyScreen = { frame_id: string; title: string; frame: ParsedFrame | null; note: ScreenNote };
/** A step, with what the person taps on the step before to get here (null on the first step, or with no data-goto). */
export type JourneyStep = JourneyScreen & { tap: string | null };
export type Journey = { board: string; title: string; description: string | null; canvasUrl: string | null; steps: JourneyStep[] };

type IssueLink = { screen_id: string; issues: { id: string; status: string; score_breakdown: unknown } | null };
type FlowRow = { board: string; title: string; description: string | null; frames: string[]; position: number };
type ScreenRow = { id: string; frame_id: string; title: string | null; source: string | null };

const NONE: ScreenNote = { issues: 0, severity: null, praise: 0 };
/** The rated severity (1-5), wherever the rating kept it. */
function severityOf(b: unknown): number | null {
  const x = b as { severity?: unknown; inputs?: { severity?: unknown } } | null;
  const s = x?.inputs?.severity ?? x?.severity;
  return typeof s === "number" ? s : null;
}

/** Per screen id: open issues (shipped and dismissed ones no longer weigh on a screen), the worst severity, and praise. */
export function screenNotes(links: IssueLink[], praise: { screen_id: string }[]): Map<string, ScreenNote> {
  const open = new Map<string, Map<string, number | null>>();
  for (const l of links) {
    if (!l.issues || l.issues.status === "shipped" || l.issues.status === "dismissed") continue;
    const mine = open.get(l.screen_id) ?? new Map<string, number | null>();
    mine.set(l.issues.id, severityOf(l.issues.score_breakdown));
    open.set(l.screen_id, mine);
  }
  const notes = new Map<string, ScreenNote>();
  for (const [id, issues] of open) {
    const rated = [...issues.values()].filter((s): s is number => s != null);
    notes.set(id, { issues: issues.size, severity: rated.length ? Math.max(...rated) : null, praise: 0 });
  }
  for (const p of praise) {
    const n = notes.get(p.screen_id) ?? { ...NONE };
    notes.set(p.screen_id, { ...n, praise: n.praise + 1 });
  }
  return notes;
}

/** The flows in canvas order, and the screens that are on none of them. Steps that aren't known screens are left out. */
export function buildJourneys(flows: FlowRow[], screens: ScreenRow[], notes: Map<string, ScreenNote>, canvasUrl: (board: string) => string | null) {
  const parsed = new Map<string, JourneyScreen>();
  for (const s of screens) parsed.set(s.frame_id, { frame_id: s.frame_id, title: s.title || s.frame_id, frame: tryParseFrame(s.source), note: notes.get(s.id) ?? NONE });
  const journeys: Journey[] = [...flows].sort((a, z) => a.position - z.position).map((f) => {
    const shown = f.frames.map((id) => parsed.get(id)).filter((s): s is JourneyScreen => !!s);
    return {
      board: f.board, title: f.title, description: f.description, canvasUrl: canvasUrl(f.board),
      steps: shown.map((s, k) => ({ ...s, tap: k > 0 && shown[k - 1].frame ? gotoLabel(shown[k - 1].frame!.root, s.frame_id) : null })),
    };
  });
  const onFlow = new Set(flows.flatMap((f) => f.frames));
  const others = [...parsed.values()].filter((s) => !onFlow.has(s.frame_id)).sort((a, z) => a.frame_id.localeCompare(z.frame_id));
  return { journeys, others };
}
