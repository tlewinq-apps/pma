import type { SupabaseClient } from "@supabase/supabase-js";
import { readerFor } from "./sync";
import { canvasFor } from "./connect";

export type ScreenSource = { frame_id: string; title: string | null; description: string | null; source: string | null };

/**
 * Screens with their Marver TSX, in the order asked. Screens synced before sources were kept read theirs from the
 * canvas (the design repo, or the built-in Celeste one), so drafting works before anyone presses Sync again.
 */
export async function screenSources(db: SupabaseClient, projectId: string, frameIds: string[]): Promise<ScreenSource[]> {
  if (!frameIds.length) return [];
  const { data, error } = await db.from("screens").select("frame_id, title, description, file, source").eq("project_id", projectId).in("frame_id", frameIds);
  if (error) throw new Error(`screens: ${error.message}`);
  const rows = (data ?? []) as (ScreenSource & { file: string | null })[];
  if (rows.some((r) => !r.source && r.file)) {
    const { data: p } = await db.from("projects").select("kind, repo_full_name, design_path, watched_branch, org_id").eq("id", projectId).maybeSingle();
    if (p) {
      const { reader } = readerFor(p, await canvasFor(projectId, db));
      for (const r of rows) if (!r.source && r.file) r.source = await reader.read(r.file).catch(() => null);
    }
  }
  const byId = new Map(rows.map((r) => [r.frame_id, { frame_id: r.frame_id, title: r.title, description: r.description, source: r.source }]));
  return frameIds.map((id) => byId.get(id)).filter((r): r is ScreenSource => !!r);
}
