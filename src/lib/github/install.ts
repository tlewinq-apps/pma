// Connect with GitHub: the company installs the PMA GitHub App, then signs in with GitHub once so PMA can check the
// installation is theirs. GitHub's setup redirect carries installation_id in the URL, where anyone could put any id, so
// the id is trusted only once GET /user/installations, with the token of the person who just signed in, lists it.
//
//   /api/github/install  ->  github.com/apps/<slug>/installations/new  ->  /api/github/setup?installation_id=…
//   ->  github.com/login/oauth/authorize (PKCE)  ->  /api/github/callback  ->  saved, back to Start here or Settings
//
// One installation belongs to one company at a time; a company connecting another installation replaces its own.
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";
import { env } from "@/lib/env";
import { audit, markConnection, saveConnection } from "@/lib/connections/store";
import { forgetGithubTokens, githubCall, githubWebUrl, GithubAppError } from "./app";

/** The cookie that ties the GitHub install page back to the person who opened it (GitHub may not echo state there). */
export const INSTALL_COOKIE = "pma_gh_install";

export const githubCallbackUrl = () => `${env.appUrl().replace(/\/+$/, "")}/api/github/callback`;

/** GitHub's page for installing the app on an account and choosing its repositories. */
export const githubInstallUrl = (state: string) => `${githubWebUrl()}/apps/${encodeURIComponent(process.env.GITHUB_APP_SLUG ?? "")}/installations/new?state=${encodeURIComponent(state)}`;

/** GitHub's sign-in for the app (user-to-server), with PKCE; it comes back to /api/github/callback. */
export function githubAuthorizeUrl(state: string, challenge: string): string {
  const q = new URLSearchParams({
    client_id: process.env.GITHUB_APP_CLIENT_ID ?? "", redirect_uri: githubCallbackUrl(), state,
    code_challenge: challenge, code_challenge_method: "S256", allow_signup: "false",
  });
  return `${githubWebUrl()}/login/oauth/authorize?${q.toString()}`;
}

/** Swaps the callback's code for the person's token. Only used to check which installations they can see. */
export async function exchangeGithubCode(code: string, verifier: string, f: typeof fetch = fetch): Promise<string> {
  const res = await f(`${githubWebUrl()}/login/oauth/access_token`, {
    method: "POST", headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: process.env.GITHUB_APP_CLIENT_ID, client_secret: process.env.GITHUB_APP_CLIENT_SECRET, code, redirect_uri: githubCallbackUrl(), code_verifier: verifier }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json().catch(() => null)) as { access_token?: string; error?: string } | null;
  if (!res.ok || !j?.access_token) throw new GithubAppError(res.status, `GitHub sign-in failed${j?.error ? `: ${j.error}` : ""}`);
  return j.access_token;
}

export type UserInstallation = { id: number; account: { login: string; type: string } | null; repository_selection?: string; permissions?: Record<string, string> };

/** The permissions Build it needs from an installation: write on contents and on pull requests. */
export const canWrite = (permissions: unknown): boolean => {
  const p = permissions && typeof permissions === "object" ? (permissions as Record<string, unknown>) : {};
  return p.contents === "write" && p.pull_requests === "write";
};

/** Just the permissions PMA cares about, for connections.display (never anything else GitHub sends). */
export const keptPermissions = (permissions: unknown): { contents: string | null; pull_requests: string | null } => {
  const p = permissions && typeof permissions === "object" ? (permissions as Record<string, unknown>) : {};
  const v = (x: unknown) => (x === "read" || x === "write" ? x : null);
  return { contents: v(p.contents), pull_requests: v(p.pull_requests) };
};

/** The app's installations this person can reach (their own account, and organizations they belong to). */
export async function userInstallations(userToken: string, f: typeof fetch = fetch): Promise<UserInstallation[]> {
  const out: UserInstallation[] = [];
  for (let page = 1; page <= 5; page++) {
    const r = await githubCall<{ total_count: number; installations: UserInstallation[] }>(`/user/installations?per_page=100&page=${page}`, { token: userToken }, {}, f);
    out.push(...r.installations);
    if (out.length >= r.total_count || r.installations.length < 100) break;
  }
  return out;
}

export type GithubInstallOutcome = { ok: true; account: string } | { ok: false; reason: "not_yours" | "taken" | "failed" };

/**
 * Saves the installation for the company that started the hand-off, once the person's own token shows it. Refuses an
 * installation another company holds. The row goes in pending first and becomes ok in a second write, so the unique
 * index (0042) turns a race between two companies into "taken" instead of a retry loop.
 */
export async function saveGithubInstallation(
  installationId: string, userToken: string, s: { orgId: string; projectId: string | null; userId: string },
  db: SupabaseClient = serviceDb(), f: typeof fetch = fetch,
): Promise<GithubInstallOutcome> {
  if (!/^\d{1,20}$/.test(installationId)) return { ok: false, reason: "not_yours" };
  const mine = (await userInstallations(userToken, f)).find((i) => String(i.id) === installationId);
  if (!mine) return { ok: false, reason: "not_yours" };

  const { data: holder } = await db.from("connections").select("org_id").eq("kind", "github").eq("status", "ok").eq("external_id", installationId).maybeSingle();
  if (holder && holder.org_id !== s.orgId) return { ok: false, reason: "taken" };

  const account = mine.account?.login ?? installationId;
  const display = { account, account_type: mine.account?.type ?? null, selection: mine.repository_selection ?? null, permissions: keptPermissions(mine.permissions) };
  const scope = { orgId: s.orgId, projectId: null };
  const conn = await saveConnection("github", scope, { status: "pending", display, externalId: installationId, userId: s.userId }, db);
  try {
    await saveConnection("github", scope, { status: "ok", display, externalId: installationId, verified: true, userId: s.userId }, db);
  } catch (e) {
    await markConnection(conn.id, "disconnected", null, db).catch(() => {});
    if (/duplicate key|23505/.test((e as Error).message)) return { ok: false, reason: "taken" };
    throw e;
  }
  forgetGithubTokens(installationId);
  await audit({ orgId: s.orgId, projectId: s.projectId, actorId: s.userId, action: "connection.connected", target: "github", detail: { account, installation_id: installationId } }, db);
  return { ok: true, account };
}

/** The installation accepted new permissions (or GitHub sent them again): the company's connection says so. */
export async function githubPermissionsChanged(installationId: string, permissions: unknown, db: SupabaseClient = serviceDb()): Promise<void> {
  const { data } = await db.from("connections").select("id, display").eq("kind", "github").eq("external_id", installationId).in("status", ["ok", "broken"]);
  for (const c of data ?? []) {
    const display = { ...((c.display as Record<string, unknown>) ?? {}), permissions: keptPermissions(permissions) };
    await db.from("connections").update({ display, updated_at: new Date().toISOString() }).eq("id", c.id as string);
  }
}

/** GitHub says the installation is gone or suspended: the company's connection becomes revoked. */
export async function revokeGithubInstallation(installationId: string, reason: string, db: SupabaseClient = serviceDb()): Promise<void> {
  const { data } = await db.from("connections").select("id, org_id").eq("kind", "github").eq("external_id", installationId).in("status", ["ok", "broken"]);
  for (const c of data ?? []) {
    await markConnection(c.id as string, "revoked", reason, db);
    await audit({ orgId: c.org_id as string, action: "connection.revoked", target: "github", detail: { installation_id: installationId, reason } }, db);
  }
  forgetGithubTokens(installationId);
}

export const GITHUB_REPO_REMOVED = (repo: string) => `PMA lost access to ${repo} on GitHub. Add it back to the PMA app's repositories on GitHub, or pick another repository.`;

/** Repositories taken out of the installation: a company whose app reads one of them is told, on the connection. */
export async function githubReposRemoved(installationId: string, repos: string[], db: SupabaseClient = serviceDb()): Promise<void> {
  if (!repos.length) return;
  const { data: conns } = await db.from("connections").select("id, org_id").eq("kind", "github").eq("status", "ok").eq("external_id", installationId);
  const lower = new Set(repos.map((r) => r.toLowerCase()));
  for (const c of conns ?? []) {
    const { data: apps } = await db.from("projects").select("repo_full_name").eq("org_id", c.org_id as string);
    const hit = (apps ?? []).map((a) => a.repo_full_name as string | null).find((r) => r && lower.has(r.toLowerCase()));
    if (hit) await markConnection(c.id as string, "broken", GITHUB_REPO_REMOVED(hit), db);
  }
}
