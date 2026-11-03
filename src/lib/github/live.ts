// See it live: an open pull request's preview site and its checks, read from GitHub as the company's installation.
// Most repositories already get a preview for every pull request from their host (Vercel, Netlify, Cloudflare Pages),
// and GitHub records it as a deployment of the pull request's head commit, with its address on the deployment's latest
// status. The checks are the check runs (GitHub Actions and other apps) and the commit statuses (older integrations,
// Vercel's own) on that commit. Read when the issue page asks, and asked again while something is still building;
// nothing is stored, so the dev App needs no webhook. Each part needs its read permission (deployments for the preview,
// checks and commit statuses for the checks); an installation that hasn't accepted them gets "needs permission".
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";
import { findConnection } from "@/lib/connections/store";
import { GithubAppError, githubAppEnabled, githubCall, githubWebUrl, installationGrantFor } from "./app";

/** What the reader needs from an installation, in the App's manifest too. */
export const LIVE_PERMISSIONS = ["deployments", "checks", "statuses"] as const;

export type LivePreview = {
  state: "ready" | "building" | "failed";
  /** The preview's address, once it is ready. */
  url: string | null;
  /** The host's build log, when it gives one. */
  logUrl: string | null;
  /** Who published it ("Vercel"), from the deployment's creator. */
  provider: string | null;
  updatedAt: string;
};
export type LiveChecks = {
  state: "passing" | "failing" | "running" | "none";
  total: number; passed: number; failed: number; running: number;
  /** The names of the checks that failed, at most five. */
  failing: string[];
  /** The pull request's Checks tab. */
  url: string;
};
export type LivePr = { number: number; url: string; preview: LivePreview | null; checks: LiveChecks | null };
export type LiveView = {
  prs: LivePr[];
  /** Why part of it can't show: GitHub isn't connected, or the installation hasn't accepted the read permissions. */
  needs: "github" | "permission" | null;
  /** No pull request has a preview and the repository has never published one, so none is coming. */
  noPreviews: boolean;
  /** Where the installation's owner reviews and accepts PMA's permissions on GitHub. */
  manageUrl: string | null;
};
export const NO_LIVE: LiveView = { prs: [], needs: null, noPreviews: false, manageUrl: null };

type Deployment = { id: number; sha: string; ref: string; environment: string; created_at: string; production_environment?: boolean; creator?: { login?: string } | null };
type DeploymentStatus = { state: string; environment_url?: string | null; target_url?: string | null; log_url?: string | null; created_at: string; updated_at?: string };
type CheckRun = { name: string; status: string; conclusion: string | null };
type CombinedStatus = { statuses: { context: string; state: string }[] };

const repoPath = (repo: string) => repo.split("/").map(encodeURIComponent).join("/");

/** A production (or Pages) deployment, which isn't the pull request's preview. Vercel names them "Production – app". */
export const isProduction = (d: Pick<Deployment, "environment" | "production_environment">) =>
  d.production_environment === true || /\bprod(uction)?\b|github-pages/i.test(d.environment);

const PROVIDERS: Record<string, string> = { vercel: "Vercel", netlify: "Netlify", "cloudflare-workers-and-pages": "Cloudflare Pages", "cloudflare-pages": "Cloudflare Pages", render: "Render", railway: "Railway", "aws-amplify": "AWS Amplify" };
/** "vercel[bot]" → "Vercel": who published the preview, as people know it. */
export function providerName(login: string | undefined | null): string | null {
  const l = (login ?? "").replace(/\[bot\]$/i, "").toLowerCase();
  if (!l) return null;
  return PROVIDERS[l] ?? l.split(/[-_]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

const FAILED_RUN = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure", "stale"]);
const newestFirst = <T extends { created_at: string }>(xs: T[]) => [...xs].sort((a, b) => b.created_at.localeCompare(a.created_at));

/** The checks on one commit, from its check runs and its commit statuses (either may be left out). */
export function summarizeChecks(runs: CheckRun[] | null, statuses: CombinedStatus["statuses"] | null, url: string): LiveChecks {
  let passed = 0, failed = 0, running = 0;
  const failing: string[] = [];
  for (const r of runs ?? []) {
    if (r.status !== "completed") running++;
    else if (r.conclusion && FAILED_RUN.has(r.conclusion)) { failed++; failing.push(r.name); }
    else passed++;
  }
  for (const s of statuses ?? []) {
    if (s.state === "pending") running++;
    else if (s.state === "failure" || s.state === "error") { failed++; failing.push(s.context); }
    else passed++;
  }
  const total = passed + failed + running;
  const state = failed ? "failing" : running ? "running" : total ? "passing" : "none";
  return { state, total, passed, failed, running, failing: failing.slice(0, 5), url };
}

/** The newest preview deployment of this commit (or, for hosts that record the branch, of the branch), with its state. */
async function previewOf(repo: string, sha: string, branch: string, token: string, f: typeof fetch): Promise<LivePreview | null> {
  const list = async (q: string) => (await githubCall<Deployment[]>(`/repos/${repoPath(repo)}/deployments?${q}&per_page=20`, { token }, {}, f)).filter((d) => !isProduction(d));
  let deps = await list(`sha=${encodeURIComponent(sha)}`);
  if (!deps.length && branch) deps = await list(`ref=${encodeURIComponent(branch)}`);
  const d = newestFirst(deps)[0];
  if (!d) return null;
  const s = newestFirst(await githubCall<DeploymentStatus[]>(`/repos/${repoPath(repo)}/deployments/${d.id}/statuses?per_page=5`, { token }, {}, f))[0];
  const provider = providerName(d.creator?.login);
  const updatedAt = s?.updated_at ?? s?.created_at ?? d.created_at;
  if (!s || s.state === "pending" || s.state === "queued" || s.state === "in_progress") return { state: "building", url: null, logUrl: s?.log_url ?? s?.target_url ?? null, provider, updatedAt };
  if (s.state === "failure" || s.state === "error") return { state: "failed", url: null, logUrl: s.log_url ?? s.target_url ?? null, provider, updatedAt };
  // success, or inactive (a newer deployment of the same environment replaced it; its address still answers)
  const url = s.environment_url || s.target_url || null;
  return url ? { state: "ready", url, logUrl: s.log_url ?? null, provider, updatedAt } : null;
}

/** Whether the repository has ever published a preview (one call, only when no pull request shows one). */
async function publishesPreviews(repo: string, token: string, f: typeof fetch): Promise<boolean> {
  const deps = await githubCall<Deployment[]>(`/repos/${repoPath(repo)}/deployments?per_page=30`, { token }, {}, f);
  return deps.some((d) => !isProduction(d));
}

const forbidden = (e: unknown) => e instanceof GithubAppError && e.status === 403;

/** The preview and checks of these pull requests, with the permissions the token carries. */
export async function readLive(o: { prs: { repo: string; number: number; url: string }[]; token: string; permissions: Record<string, string>; manageUrl: string | null; fetch?: typeof fetch }): Promise<LiveView> {
  const f = o.fetch ?? fetch;
  let canDeploy = !!o.permissions.deployments;
  let canChecks = !!o.permissions.checks;
  let canStatuses = !!o.permissions.statuses;
  const prs: LivePr[] = [];
  for (const pr of o.prs) {
    let head: { sha: string; ref: string };
    try {
      const p = await githubCall<{ head: { sha: string; ref: string } }>(`/repos/${repoPath(pr.repo)}/pulls/${pr.number}`, { token: o.token }, {}, f);
      head = p.head;
    } catch (e) {
      if (e instanceof GithubAppError && (e.status === 404 || e.status === 403)) continue; // gone, or not in the installation
      throw e;
    }
    // The preview, the check runs and the commit statuses at once; a 403 on one turns just that part off.
    const part = <T,>(on: boolean, read: () => Promise<T>, off: () => void): Promise<T | null> =>
      on ? read().catch((e) => { if (forbidden(e)) { off(); return null; } throw e; }) : Promise.resolve(null);
    const [preview, runs, statuses] = await Promise.all([
      part(canDeploy, () => previewOf(pr.repo, head.sha, head.ref, o.token, f), () => { canDeploy = false; }),
      part(canChecks, async () => (await githubCall<{ check_runs: CheckRun[] }>(`/repos/${repoPath(pr.repo)}/commits/${head.sha}/check-runs?per_page=100`, { token: o.token }, {}, f)).check_runs, () => { canChecks = false; }),
      part(canStatuses, async () => (await githubCall<CombinedStatus>(`/repos/${repoPath(pr.repo)}/commits/${head.sha}/status`, { token: o.token }, {}, f)).statuses, () => { canStatuses = false; }),
    ]);
    const checksUrl = `${githubWebUrl()}/${pr.repo}/pull/${pr.number}/checks`;
    prs.push({ number: pr.number, url: pr.url, preview, checks: canChecks || canStatuses ? summarizeChecks(runs, statuses, checksUrl) : null });
  }
  let noPreviews = false;
  if (canDeploy && prs.length && prs.every((p) => !p.preview)) {
    try { noPreviews = !(await publishesPreviews(o.prs[0].repo, o.token, f)); } catch (e) { if (forbidden(e)) canDeploy = false; else throw e; }
  }
  const needs = canDeploy && canChecks && canStatuses ? null : "permission";
  return { prs, needs, noPreviews, manageUrl: needs ? o.manageUrl : null };
}

/** The installation's settings on GitHub, where its owner accepts new permissions. */
export function installationSettingsUrl(installationId: string, account: unknown, accountType: unknown): string {
  const web = githubWebUrl();
  return accountType === "Organization" && typeof account === "string"
    ? `${web}/organizations/${encodeURIComponent(account)}/settings/installations/${installationId}`
    : `${web}/settings/installations/${installationId}`;
}

const CACHE_MS = 15_000;
const cache = new Map<string, { at: number; view: LiveView }>();

/** Forgets cached reads (in tests). */
export function forgetLive(): void { cache.clear(); }

/**
 * See it live for a company's open pull requests: through its GitHub connection, kept for 15 seconds so a page asking
 * again (or several people on it) doesn't ask GitHub each time.
 */
export async function liveFor(orgId: string, prs: { repo: string; number: number; url: string }[], o: { db?: SupabaseClient; fetch?: typeof fetch; now?: () => number } = {}): Promise<LiveView> {
  if (!prs.length || !githubAppEnabled()) return NO_LIVE;
  const now = o.now ?? Date.now;
  const conn = await findConnection("github", { orgId, projectId: null }, o.db ?? serviceDb()).catch(() => null);
  if (!conn?.external_id || (conn.status !== "ok" && conn.status !== "broken")) return { ...NO_LIVE, needs: "github" };
  const key = `${conn.external_id}|${prs.map((p) => `${p.repo.toLowerCase()}#${p.number}`).join(",")}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < CACHE_MS) return hit.view;
  const grant = await installationGrantFor(conn.external_id, LIVE_PERMISSIONS, o.fetch, now);
  const view = await readLive({ prs, token: grant.token, permissions: grant.permissions, fetch: o.fetch,
    manageUrl: installationSettingsUrl(conn.external_id, conn.display.account, conn.display.account_type) });
  cache.set(key, { at: now(), view });
  return view;
}
