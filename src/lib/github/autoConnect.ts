// After Connect with GitHub: when the installation was given exactly one repository and the app has none yet, connect
// it, so the person isn't asked to pick from a list of one. It reads the repository first, as Connect repository does
// (only a repository PMA can read is saved), and never touches the demo app or an app that already has a repository.
// Best effort: anything that goes wrong leaves the picker in place.
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";
import { openRepo } from "@/lib/repo/snapshot";
import { installationRepos, type InstalledRepo } from "./app";

export type AutoConnectDeps = {
  repos: (installationId: string) => Promise<InstalledRepo[]>;
  read: (repo: string, orgId: string) => Promise<{ ref: string } | null>;
};

const defaults: AutoConnectDeps = {
  repos: (id) => installationRepos(id),
  read: (repo, orgId) => openRepo({ repo_full_name: repo, watched_branch: null, org_id: orgId }),
};

/** The repository connected, or null when there was nothing to do (or it couldn't be read). */
export async function connectOnlyRepository(installationId: string, scope: { orgId: string; projectId: string | null }, db?: SupabaseClient, deps: AutoConnectDeps = defaults): Promise<string | null> {
  if (!scope.projectId) return null;
  try {
    db ??= serviceDb();
    const { data: app } = await db.from("projects").select("id, kind, repo_full_name").eq("id", scope.projectId).eq("org_id", scope.orgId).maybeSingle();
    if (!app || app.kind === "demo" || app.repo_full_name) return null;
    const repos = await deps.repos(installationId);
    if (repos.length !== 1) return null;
    const snap = await deps.read(repos[0].full_name, scope.orgId);
    if (!snap) return null;
    const { error } = await db.from("projects").update({ repo_full_name: repos[0].full_name, watched_branch: snap.ref }).eq("id", scope.projectId);
    return error ? null : repos[0].full_name;
  } catch (e) {
    console.warn("[github] connecting the only repository failed", (e as Error).message);
    return null;
  }
}
