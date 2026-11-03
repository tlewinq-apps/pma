// The PMA GitHub App: a company installs it on the repositories it chooses, and PMA reads them with installation
// tokens it mints when needed (an hour long; kept until five minutes before they lapse). The app signs its own JWT
// (RS256, node:crypto) from GITHUB_APP_PRIVATE_KEY. A company's token comes only from its own github connection, and
// GitHub lets a token read only what that installation was given, so one company can't read another's private repo.
// GITHUB_API_URL and GITHUB_WEB_URL point the e2e suite at fakes.
import { createSign } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";
import { findConnection, markConnection } from "@/lib/connections/store";

export const githubApiUrl = () => (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/+$/, "");
export const githubWebUrl = () => (process.env.GITHUB_WEB_URL ?? "https://github.com").replace(/\/+$/, "");

/** Companies can Connect with GitHub: the app is registered and its keys are set on this deployment. */
export const githubAppEnabled = () =>
  !!process.env.GITHUB_APP_ID && !!process.env.GITHUB_APP_SLUG && !!process.env.GITHUB_APP_CLIENT_ID && !!process.env.GITHUB_APP_CLIENT_SECRET && !!process.env.GITHUB_APP_PRIVATE_KEY;

export class GithubAppError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export const GITHUB_HEADERS = { accept: "application/vnd.github+json", "user-agent": "PMA", "x-github-api-version": "2022-11-28" } as const;

/** The private key as GitHub gave it; an env var may hold it with its newlines escaped. */
const privateKey = () => (process.env.GITHUB_APP_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

/** The app's own JWT: issued a minute in the past (clock drift), valid nine minutes, signed RS256. */
export function appJwt(now = Date.now(), key = privateKey(), appId = process.env.GITHUB_APP_ID ?? ""): string {
  const iat = Math.floor(now / 1000) - 60;
  const body = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iat, exp: iat + 600, iss: appId }))}`;
  const sig = createSign("RSA-SHA256").update(body).sign(key);
  return `${body}.${b64url(sig)}`;
}

/** GitHub's REST API, as the app (JWT), an installation or a person (token); a non-2xx answer throws GithubAppError. */
export async function githubCall<T>(path: string, auth: { jwt: string } | { token: string }, init: { method?: string; body?: unknown } = {}, f: typeof fetch = fetch): Promise<T> {
  let res: Response;
  try {
    res = await f(`${githubApiUrl()}${path}`, {
      method: init.method ?? "GET",
      headers: { ...GITHUB_HEADERS, authorization: `Bearer ${"jwt" in auth ? auth.jwt : auth.token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new GithubAppError(0, `GitHub unreachable: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new GithubAppError(res.status, `GitHub ${res.status}${j?.message ? `: ${j.message}` : ""}`);
  }
  return (await res.json()) as T;
}

const TOKEN_MARGIN_MS = 5 * 60_000;
const tokens = new Map<string, { token: string; expiresAt: number; permissions: Record<string, string> }>();

/** Forgets minted tokens (after an uninstall or new permissions, and in tests). */
export function forgetGithubTokens(installationId?: string): void {
  if (installationId) { tokens.delete(installationId); rechecked.delete(installationId); }
  else { tokens.clear(); rechecked.clear(); }
}

const RECHECK_MS = 2 * 60_000;
const rechecked = new Map<string, number>();

/**
 * A grant that carries these permissions if the installation has accepted them. A token keeps the permissions it was
 * minted with, so one minted before the company accepted new ones is minted again, at most every two minutes per
 * installation (an installation that hasn't accepted them yet isn't asked on every read).
 */
export async function installationGrantFor(installationId: string, needs: readonly string[], f: typeof fetch = fetch, now = Date.now): Promise<{ token: string; permissions: Record<string, string> }> {
  const grant = await installationGrant(installationId, f, now);
  if (needs.every((p) => grant.permissions[p])) return grant;
  if (now() - (rechecked.get(installationId) ?? 0) < RECHECK_MS) return grant;
  rechecked.set(installationId, now());
  tokens.delete(installationId);
  return installationGrant(installationId, f, now);
}

/** A token for this installation, minted with the app's JWT and reused until five minutes before it lapses. */
export async function installationToken(installationId: string, f: typeof fetch = fetch, now = Date.now): Promise<string> {
  return (await installationGrant(installationId, f, now)).token;
}

/** The token and the permissions GitHub granted it (what the installation accepted), minted or reused as above. */
export async function installationGrant(installationId: string, f: typeof fetch = fetch, now = Date.now): Promise<{ token: string; permissions: Record<string, string> }> {
  const hit = tokens.get(installationId);
  if (hit && hit.expiresAt - TOKEN_MARGIN_MS > now()) return hit;
  const r = await githubCall<{ token: string; expires_at: string; permissions?: Record<string, string> }>(`/app/installations/${encodeURIComponent(installationId)}/access_tokens`, { jwt: appJwt(now()) }, { method: "POST" }, f);
  const grant = { token: r.token, expiresAt: Date.parse(r.expires_at) || now() + 55 * 60_000, permissions: r.permissions ?? {} };
  tokens.set(installationId, grant);
  return grant;
}

export const GITHUB_LOST = "PMA can't reach your GitHub installation any more. Connect with GitHub again.";

/**
 * The company's GitHub token, or null when it hasn't connected GitHub (or the app isn't set up here). An installation
 * GitHub no longer knows (uninstalled, suspended) marks the connection Needs attention and reads go on without it.
 */
export async function githubAuthForOrg(orgId: string, db: SupabaseClient = serviceDb(), f: typeof fetch = fetch): Promise<{ scope: string; token: string } | null> {
  if (!githubAppEnabled()) return null;
  const conn = await findConnection("github", { orgId, projectId: null }, db).catch(() => null);
  // Needs attention (a repository was taken out, or a mint failed) still tries: the installation may read the rest.
  if (!conn || (conn.status !== "ok" && conn.status !== "broken") || !conn.external_id) return null;
  try {
    return { scope: orgId, token: await installationToken(conn.external_id, f) };
  } catch (e) {
    if (e instanceof GithubAppError && (e.status === 401 || e.status === 403 || e.status === 404)) {
      await markConnection(conn.id, "broken", GITHUB_LOST, db).catch(() => {});
    } else console.error("[github] installation token failed", (e as Error).message);
    return null;
  }
}

export type InstalledRepo = { full_name: string; private: boolean; default_branch: string };

/** The repositories the installation was given (up to 500), for the repo picker. */
export async function installationRepos(installationId: string, f: typeof fetch = fetch): Promise<InstalledRepo[]> {
  const token = await installationToken(installationId, f);
  const out: InstalledRepo[] = [];
  for (let page = 1; page <= 5; page++) {
    const r = await githubCall<{ total_count: number; repositories: InstalledRepo[] }>(`/installation/repositories?per_page=100&page=${page}`, { token }, {}, f);
    out.push(...r.repositories.map((x) => ({ full_name: x.full_name, private: !!x.private, default_branch: x.default_branch || "main" })));
    if (out.length >= r.total_count || r.repositories.length < 100) break;
  }
  return out.sort((a, b) => a.full_name.localeCompare(b.full_name));
}
