// One way to read a connected repository, whoever holds it: a dev-only checkout under .local-repos (localDir.ts) or a
// GitHub repo's tarball (githubTarball.ts): public with no credentials, or private through the company's PMA GitHub App
// installation (src/lib/github/app.ts), found from the app's org_id. Code read through it is untrusted data: callers
// quote it to the model, never follow it.
import { localBranch, localRepoDir, localSnapshot } from "./localDir";
import { githubRepoMeta, githubSnapshot, GITHUB_RATE_LIMITED, GITHUB_UNREACHABLE, type Fetch, type GithubAuth, type RepoMeta } from "./githubTarball";

export { RepoPathError } from "./localDir";
export { RepoFetchError } from "./githubTarball";

export type RepoFile = { path: string; size: number };

export interface RepoSnapshot {
  repo: string;
  ref: string;
  source: "local" | "github";
  /** Source files only (see files.ts), sorted by path, none over 400 KB. */
  files(): RepoFile[];
  /** The text of a listed file; null for an unknown path, a binary file or one over 400 KB. */
  read(path: string): string | null;
  /** True when the listing stopped early (the file or download cap), so files() is only part of the repo. */
  truncated?: boolean;
}

export type RepoProblem = "repo_invalid" | "repo_private" | "repo_missing";

export const REPO_MESSAGES = {
  repo_invalid: "Use owner/name, for example acme/web-app.",
  repo_private: "PMA can't read that repository. If it's private, use Connect with GitHub and give the PMA app access to it.",
  repo_missing: "That repository or branch doesn't exist.",
  branch_invalid: "That isn't a valid branch name.",
  github_unreachable: GITHUB_UNREACHABLE,
  github_rate_limited: GITHUB_RATE_LIMITED,
} as const;

const PART = /^[A-Za-z0-9._-]+$/;

/** "repo_invalid" unless `repo` is owner/name, each part letters, digits, ".", "_" or "-" (and never "." or ".."). */
export function connectRepoProblem(repo: string): "repo_invalid" | null {
  const parts = repo.split("/");
  const ok = parts.length === 2 && parts.every((p) => PART.test(p) && p !== "." && p !== "..");
  return ok ? null : "repo_invalid";
}

export type RepoReadOptions = {
  fetch?: Fetch;
  /** The company's installation token; when left out, it is found from the app's org_id. null reads public only. */
  auth?: GithubAuth | null;
};

/** The company's GitHub installation token, or null (no org given, or it hasn't connected GitHub). */
async function authFor(orgId: string | null | undefined, opts: RepoReadOptions): Promise<GithubAuth | null> {
  if (opts.auth !== undefined) return opts.auth;
  if (!orgId) return null;
  const { githubAuthForOrg } = await import("@/lib/github/app"); // lazy: keeps the database client out of pure callers
  return githubAuthForOrg(orgId);
}

/** The repo's meta as the company sees it, then as the public sees it (a public repo the installation wasn't given). */
async function metaFor(repo: string, auth: GithubAuth | null, f: Fetch | undefined): Promise<RepoMeta> {
  const meta = await githubRepoMeta(repo, { fetch: f, auth });
  return meta.exists || !auth ? meta : githubRepoMeta(repo, { fetch: f });
}

/**
 * The repository an app points at, or null when it has none or it can't be read (private and not given to the
 * company's GitHub installation, missing, or the branch doesn't exist). A local checkout wins when there is one (dev);
 * otherwise the tarball, read as the company's installation when it has one (falling back to public), at
 * `watched_branch` or, when that is null, the default branch the API reports. Throws RepoFetchError when GitHub can't
 * be asked.
 */
export async function openRepo(
  project: { repo_full_name: string | null; watched_branch: string | null; org_id?: string | null },
  opts: RepoReadOptions = {},
): Promise<RepoSnapshot | null> {
  const repo = project.repo_full_name;
  if (!repo || connectRepoProblem(repo)) return null;
  const dir = localRepoDir(repo);
  if (dir) return localSnapshot(repo, dir, project.watched_branch ?? localBranch(dir));
  const auth = await authFor(project.org_id, opts);
  let ref = project.watched_branch;
  if (!ref) {
    const meta = await metaFor(repo, auth, opts.fetch);
    if (!meta.exists) return null;
    ref = meta.defaultBranch;
  }
  const snap = await githubSnapshot(repo, ref, { fetch: opts.fetch, auth });
  return snap || !auth ? snap : githubSnapshot(repo, ref, { fetch: opts.fetch });
}

/**
 * Why openRepo found nothing for a well-formed owner/name: "repo_missing" when GitHub shows the repo to this company
 * (so the branch is wrong), "repo_private" when it doesn't (private and not given to its installation, or no such
 * repo: GitHub answers both with 404).
 */
export async function unreadableReason(repo: string, opts: RepoReadOptions & { orgId?: string | null } = {}): Promise<"repo_private" | "repo_missing"> {
  return (await metaFor(repo, await authFor(opts.orgId, opts), opts.fetch)).exists ? "repo_missing" : "repo_private";
}
