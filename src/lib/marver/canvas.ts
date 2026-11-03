// The local Marver canvas. With MARVER_CANVAS_DIR set (say demo/celeste-design while `npx marver dev` runs), each
// proposed screen and flow is also written into that canvas as its own scene and board, so it appears in Marver next
// to the app's real screens. Unset on Vercel, where nothing is written.
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const canvasDir = () => process.env.MARVER_CANVAS_DIR?.trim() || null;
/** The board's link on the local canvas (MARVER_CANVAS_URL, e.g. http://localhost:5298), or null. */
export function canvasBoardUrl(board: string | null | undefined): string | null {
  const base = process.env.MARVER_CANVAS_URL?.trim().replace(/\/+$/, "");
  return base && board ? `${base}/#/b/${board}` : null;
}

const FRAME_ID = /^[a-z0-9-]+\/[a-z0-9-]+$/;
/** A frame on a board: an existing canvas frame, or a proposed one (with its source) written under pma-<id>/. */
export type CanvasCell = { frame_id: string; source?: string | null } | null;

/**
 * Writes the proposed frames and one board laying the rows out (current on top, proposed below; a null cell is a gap).
 * Returns the board name, or null when there is no local canvas. Ids are checked, so nothing lands outside design/.
 */
export async function writeCanvasBoard(o: { shortId: string; suffix?: string; title: string; description: string; rows: CanvasCell[][] }): Promise<string | null> {
  const dir = canvasDir();
  if (!dir || !/^[a-z0-9]+$/.test(o.shortId)) return null;
  const scene = `pma-${o.shortId}`;
  const board = o.suffix ? `${scene}-${o.suffix.replace(/[^a-z0-9-]/g, "")}` : scene;
  const root = resolve(dir, "design");
  const nodes: { frame: string; x: number; y: number }[] = [];
  for (const [y, row] of o.rows.entries()) {
    for (const [x, cell] of row.entries()) {
      if (!cell || !FRAME_ID.test(cell.frame_id)) continue;
      let frame = cell.frame_id;
      if (cell.source) {
        const name = cell.frame_id.replace("/", "-");
        await mkdir(join(root, "scenes", scene), { recursive: true });
        await writeFile(join(root, "scenes", scene, `${name}.tsx`), cell.source);
        frame = `${scene}/${name}`;
      }
      nodes.push({ frame, x: x * 470, y: y * 1000 });
    }
  }
  await mkdir(join(root, "boards"), { recursive: true });
  await writeFile(join(root, "boards", `${board}.json`), `${JSON.stringify({ version: 1, name: board, title: o.title, description: o.description, order: 100, auto: false, nodes }, null, 2)}\n`);
  return board;
}
