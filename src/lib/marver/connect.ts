// "Connect to Marver" for a customer app: an existing Marver canvas, in the app's repository or another one the
// company can read (a public repo, a private one its GitHub installation was given, or a dev checkout under .local-repos). PMA checks the canvas's manifest parses and
// has live frames before it is saved, then syncs its screens and flow boards. Creating a canvas from the app's own
// components needs the sandbox runner and comes later. The demo keeps its built-in Celeste canvas.
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";
import { connectRepoProblem, openRepo, REPO_MESSAGES, unreadableReason, type RepoSnapshot } from "@/lib/repo/snapshot";
import { findConnection } from "@/lib/connections/store";
import { isArchivedScene, isProposalScene, parseManifest } from "./manifest";

export type CanvasLocation = { repo: string; branch: string | null; path: string };

/** A folder inside the repository: letters, digits, - _ . and /, never .. or a leading /. */
export function canvasPathProblem(path: string): string | null {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_\-./]{0,119}$/.test(path) || path.split("/").some((p) => p === ".." || p === "")) return "Use the canvas folder inside the repository, for example design.";
  return null;
}

/** The location as asked, with the app's repository and design/ as the defaults; or what's wrong with it. */
export function canvasLocation(body: { repo?: unknown; branch?: unknown; path?: unknown }, app: { repo_full_name: string | null; watched_branch: string | null }): CanvasLocation | { error: string } {
  const repo = typeof body.repo === "string" && body.repo.trim() ? body.repo.trim() : app.repo_full_name;
  if (!repo) return { error: "Connect your repository first, or name the repository that holds the canvas." };
  if (connectRepoProblem(repo)) return { error: REPO_MESSAGES.repo_invalid };
  const branch = typeof body.branch === "string" && body.branch.trim() ? body.branch.trim() : repo === app.repo_full_name ? app.watched_branch : null;
  if (branch && !/^[\w./-]{1,200}$/.test(branch)) return { error: "That branch name isn't valid." };
  const path = (typeof body.path === "string" && body.path.trim() ? body.path.trim() : "design").replace(/\/+$/, "");
  const problem = canvasPathProblem(path);
  return problem ? { error: problem } : { repo, branch, path };
}

export type CanvasCheck = { ok: true; frames: number } | { ok: false; error: string };

/** Reads the canvas's manifest, as the company (its GitHub installation, if any): it must exist, parse and list at least one live frame. */
export async function checkCanvas(
  loc: CanvasLocation,
  open: (p: { repo_full_name: string; watched_branch: string | null; org_id?: string | null }) => Promise<RepoSnapshot | null> = openRepo,
  orgId: string | null = null,
): Promise<CanvasCheck> {
  const snap = await open({ repo_full_name: loc.repo, watched_branch: loc.branch, org_id: orgId });
  if (!snap) return { ok: false, error: REPO_MESSAGES[await unreadableReason(loc.repo, { orgId }).catch(() => "repo_private" as const)] };
  const raw = snap.read(`${loc.path}/manifest.json`);
  // A repository name can end in "." (acme/Closet.), so no punctuation follows it directly.
  if (!raw) return { ok: false, error: `PMA found no ${loc.path}/manifest.json in ${loc.repo} yet. Run npx marver init in the repository, open the canvas once, and commit the ${loc.path} folder.` };
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return { ok: false, error: `${loc.path}/manifest.json isn't valid JSON.` }; }
  const frames = parseManifest(json).filter((f) => !isArchivedScene(f.scene) && !isProposalScene(f.scene) && !f.id.startsWith("components/"));
  if (!frames.length) return { ok: false, error: "The canvas has no frames yet. Add a screen in Marver and commit it, then connect again." };
  return { ok: true, frames: frames.length };
}

/** Where a customer app's connected canvas lives, or null when it has none (it then reads its own repository's design/). */
export async function canvasFor(projectId: string, db: SupabaseClient = serviceDb()): Promise<CanvasLocation | null> {
  try {
    const { data: p } = await db.from("projects").select("org_id, kind").eq("id", projectId).maybeSingle();
    if (!p || p.kind === "demo") return null;
    const conn = await findConnection("marver", { orgId: p.org_id as string, projectId }, db);
    const c = conn?.status === "ok" ? (conn.config as Partial<CanvasLocation>) : null;
    return c?.repo && c.path ? { repo: c.repo, branch: c.branch ?? null, path: c.path } : null;
  } catch {
    return null; // no connection row to read: the app reads its own repository's canvas, as before
  }
}
