import { serviceDb } from "@/lib/db/server";
import { embed } from "@/lib/embeddings";
import { embeddingsEnabled } from "@/lib/env";
import { planScreenSync, assertLiveFrames } from "./plan";
import { parseManifest, extractCopy, isArchivedScene, isProposalScene } from "./manifest";
import { fixtureReader, githubReader, snapshotReader, type DesignReader } from "./reader";
import { mayUseDeploymentToken } from "@/lib/drafts/demo";
import { readFlowBoards, type FlowBoard } from "./boards";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canvasFor, type CanvasLocation } from "./connect";

/**
 * The canvas to read. The demo app: its design repo through the deployment's GitHub token when there is one, otherwise
 * the built-in Celeste canvas. A customer app never uses that token (see mayUseDeploymentToken) nor the Celeste
 * canvas: it reads its own repository through openRepo, and with no canvas there it has no Marver screens.
 */
export function readerFor(p: { kind: string | null; repo_full_name: string | null; design_path: string | null; watched_branch: string | null; org_id?: string | null }, canvas?: CanvasLocation | null): { reader: DesignReader; designPath: string; fromRepo: boolean } {
  // A customer app's connected Marver canvas (Connect to Marver) may live in another repository than the app's code.
  if (!mayUseDeploymentToken(p.kind) && canvas) return { reader: snapshotReader({ repo_full_name: canvas.repo, watched_branch: canvas.branch, org_id: p.org_id }), designPath: canvas.path, fromRepo: true };
  if (!mayUseDeploymentToken(p.kind)) return { reader: snapshotReader(p), designPath: p.design_path ?? "design", fromRepo: !!p.repo_full_name };
  const github = !!p.repo_full_name && !!process.env.GITHUB_TOKEN;
  return github
    ? { reader: githubReader(p.repo_full_name!, p.watched_branch ?? "main"), designPath: p.design_path ?? "design", fromRepo: true }
    : { reader: fixtureReader(), designPath: "design", fromRepo: false };
}

/**
 * Reads the Marver manifest and frames into `screens`, and the canvas's flow boards into `flows`: from the connected
 * design repo when there is one and a GitHub token, otherwise from the built-in Celeste canvas
 * (demo/celeste-design), so the screen map works offline. Each screen keeps its TSX, which PMA draws.
 */
export async function syncScreens(projectId: string): Promise<{ count: number; flows: number; source: string }> {
  const db = serviceDb();
  const { data: p } = await db.from("projects").select("kind,repo_full_name,design_path,watched_branch,org_id").eq("id", projectId).single();
  if (!p) throw new Error("Project not found");
  const { reader, designPath } = readerFor(p, await canvasFor(projectId, db));
  const manifestRaw = await reader.read(`${designPath}/manifest.json`);
  if (!manifestRaw) throw new Error(`No ${designPath}/manifest.json in ${reader.label} — run \`npx marver dev\` once and commit design/`);
  let manifest: unknown;
  try { manifest = JSON.parse(manifestRaw); } catch { throw new Error(`${designPath}/manifest.json is not valid JSON`); }
  const frames = parseManifest(manifest).filter((f) => !isArchivedScene(f.scene) && !isProposalScene(f.scene) && !f.id.startsWith("components/"));
  assertLiveFrames(frames.length);
  const rawRows = [];
  for (const f of frames) {
    const src = f.kind === "tsx" ? (await reader.read(f.file)) ?? "" : "";
    rawRows.push({ project_id: projectId, frame_id: f.id, scene: f.scene, file: f.file, title: f.title ?? null, description: f.description ?? f.note ?? null, copy_text: extractCopy(src), variant_group: f.variantGroup ?? null, source: src || null });
  }
  const { data: existing, error: exErr } = await db.from("screens").select("id,frame_id").eq("project_id", projectId);
  if (exErr) throw new Error(exErr.message);
  const { rows, staleIds } = planScreenSync(existing ?? [], rawRows);
  // Without a Voyage key screens are stored unembedded; the pipeline then offers Claude every screen instead.
  const vectors = embeddingsEnabled() ? await embed(rows.map((r) => [r.title, r.description, r.copy_text].filter(Boolean).join("\n")), "document") : null;
  const { error } = await db.from("screens").upsert(rows.map((r, i) => ({ ...r, embedding: vectors ? `[${vectors[i].join(",")}]` : null })), { onConflict: "project_id,frame_id" });
  if (error) throw new Error(error.message);
  if (staleIds.length) {
    const { error: delErr } = await db.from("screens").delete().in("id", staleIds);
    if (delErr) throw new Error(delErr.message);
  }
  const flows = await readFlowBoards(reader, designPath, new Set(rows.map((r) => r.frame_id)));
  await saveFlows(db, projectId, flows);
  return { count: rows.length, flows: flows.length, source: reader.label };
}

/** Replaces the project's flows with these boards (upsert by board name, then drop boards that are gone). */
export async function saveFlows(db: SupabaseClient, projectId: string, flows: FlowBoard[]): Promise<void> {
  if (flows.length) {
    const { error } = await db.from("flows").upsert(flows.map((f) => ({ project_id: projectId, board: f.board, title: f.title, description: f.description, frames: f.frames, position: f.position })), { onConflict: "project_id,board" });
    if (error) throw new Error(`flows: ${error.message}`);
  }
  let stale = db.from("flows").delete().eq("project_id", projectId);
  if (flows.length) stale = stale.not("board", "in", `(${flows.map((f) => `"${f.board}"`).join(",")})`);
  const { error } = await stale;
  if (error) throw new Error(`flows: ${error.message}`);
}
