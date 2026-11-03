// Starting a Build it attempt: what the company's GitHub connection allows (BuildCaps), and a queued builds row handed
// to a fresh invocation (run.ts). Server only; the routes check who is asking before they call it.
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";
import { githubView } from "@/lib/github/view";
import { installationGrant } from "@/lib/github/app";
import { canWrite, githubPermissionsChanged } from "@/lib/github/install";
import { findConnection } from "@/lib/connections/store";
import type { BuildCaps, BuildMode } from "@/lib/handoff/build";
import { kickBuild } from "./run";

/**
 * Whether this company can use Build it: GitHub connected, and its installation accepted write access. The stored
 * permissions come from the connect and from the App's webhook; when they say no write, GitHub is asked once more (a
 * token's own permissions, cached for its hour), so an acceptance the webhook didn't report (dev has no webhook, or a
 * delivery was missed) still opens Build it, and the stored record catches up.
 */
export async function buildCaps(orgId: string): Promise<BuildCaps> {
  const g = await githubView(orgId).catch(() => null);
  if (!g?.connected) return { githubConnected: false, githubWrite: false };
  if (g.write) return { githubConnected: true, githubWrite: true };
  try {
    const conn = await findConnection("github", { orgId, projectId: null });
    if (!conn?.external_id) return { githubConnected: true, githubWrite: false };
    const grant = await installationGrant(conn.external_id);
    if (!canWrite(grant.permissions)) return { githubConnected: true, githubWrite: false };
    await githubPermissionsChanged(conn.external_id, grant.permissions);
    return { githubConnected: true, githubWrite: true };
  } catch {
    return { githubConnected: true, githubWrite: false };
  }
}

/** Queues a build of the issue's approved change and asks a fresh invocation to run it. Returns its id. */
export async function startBuild(o: { issueId: string; projectId: string; mode: Exclude<BuildMode, "claude_code">; branch: string | null; userId: string | null; origin: string }, db: SupabaseClient = serviceDb()): Promise<string> {
  const { data, error } = await db.from("builds").insert({
    issue_id: o.issueId, project_id: o.projectId, mode: o.mode, head_branch: o.mode === "branch" ? o.branch : null, started_by: o.userId,
    steps: ["Waiting to start"],
  }).select("id").single();
  if (error || !data) throw new Error(`queueing the build failed: ${error?.message ?? "no row"}`);
  kickBuild(data.id as string, o.origin);
  return data.id as string;
}
