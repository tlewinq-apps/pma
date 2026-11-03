// Build it's GitHub writes, as the company's PMA GitHub App installation: one commit with the staged files on top of
// the base commit (Git Data API: tree, commit), then a fresh branch and a pull request, or a fast-forward of a branch
// the company picked. Never a force push, never a merge. Every staged path passes the guards again here, and a path
// that exists in the repository but that PMA didn't read (binary, generated, too large) is refused, so a write can't
// clobber a file Claude never saw.
import { githubCall, GithubAppError } from "@/lib/github/app";
import { pathProblem } from "./guards";
import { BuildError } from "./agent";

export type Gh = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;

/** GitHub's API with this installation token. */
export const ghWith = (token: string, f: typeof fetch = fetch): Gh => (path, init = {}) => githubCall(path, { token }, init, f);

const enc = (s: string) => s.split("/").map(encodeURIComponent).join("/");
const status = (e: unknown) => (e instanceof GithubAppError ? e.status : 0);

export async function defaultBranchOf(gh: Gh, repo: string): Promise<string> {
  const r = await gh<{ default_branch?: string }>(`/repos/${enc(repo)}`);
  return r.default_branch || "main";
}

/** The branch's head commit, or null when there's no such branch. */
export async function branchSha(gh: Gh, repo: string, branch: string): Promise<string | null> {
  try {
    const r = await gh<{ object?: { sha?: string } }>(`/repos/${enc(repo)}/git/ref/heads/${enc(branch)}`);
    return r.object?.sha ?? null;
  } catch (e) {
    if (status(e) === 404) return null;
    throw e;
  }
}

type TreeEntry = { path: string; mode: string; type: string };

/**
 * One commit on top of `baseSha` with the staged files (files whose content didn't change are left out). `readable`
 * holds the paths PMA read from the repository: an existing file outside it can't be written. Returns the commit and
 * the paths it changed.
 */
export async function commitStaged(gh: Gh, o: { repo: string; baseSha: string; staged: Map<string, string>; original: (path: string) => string | null; readable: Set<string>; message: string }): Promise<{ sha: string; files: string[] }> {
  const base = await gh<{ tree: { sha: string } }>(`/repos/${enc(o.repo)}/git/commits/${o.baseSha}`);
  const tree = await gh<{ tree: TreeEntry[]; truncated?: boolean }>(`/repos/${enc(o.repo)}/git/trees/${base.tree.sha}?recursive=1`);
  const existing = new Map(tree.tree.map((t) => [t.path, t]));
  const entries: { path: string; mode: string; type: "blob"; content: string }[] = [];
  for (const [path, content] of o.staged) {
    const problem = pathProblem(path);
    if (problem) throw new BuildError(`PMA can't change ${path}: ${problem}`);
    const at = existing.get(path);
    if (at && at.type !== "blob") throw new BuildError(`PMA can't write ${path}: it's a folder or a submodule in the repository.`);
    if (at && (at.mode === "120000" || !o.readable.has(path))) throw new BuildError(`PMA can't change ${path}: it's a file PMA doesn't read (binary, generated or very large).`);
    if (o.original(path) === content) continue;
    entries.push({ path, mode: at?.mode ?? "100644", type: "blob", content });
  }
  if (!entries.length) throw new BuildError("The change Claude wrote leaves every file as it was, so there's nothing to commit.");
  const newTree = await gh<{ sha: string }>(`/repos/${enc(o.repo)}/git/trees`, { method: "POST", body: { base_tree: base.tree.sha, tree: entries } });
  const commit = await gh<{ sha: string }>(`/repos/${enc(o.repo)}/git/commits`, { method: "POST", body: { message: o.message, tree: newTree.sha, parents: [o.baseSha] } });
  return { sha: commit.sha, files: entries.map((e) => e.path).sort() };
}

/** A new branch at `sha`, named `name` or, when that's taken, name-2, name-3 …; returns the name used. */
export async function pushNewBranch(gh: Gh, repo: string, name: string, sha: string): Promise<string> {
  for (let n = 1; n <= 6; n++) {
    const branch = n === 1 ? name : `${name}-${n}`;
    try {
      await gh(`/repos/${enc(repo)}/git/refs`, { method: "POST", body: { ref: `refs/heads/${branch}`, sha } });
      return branch;
    } catch (e) {
      if (status(e) !== 422) throw e; // 422: the branch exists
    }
  }
  throw new BuildError(`Branches named ${name} already exist. Delete old ones, then try again.`);
}

/** Moves `branch` forward to `sha`, never forced: if someone pushed meanwhile, GitHub refuses and the build fails. */
export async function fastForward(gh: Gh, repo: string, branch: string, sha: string): Promise<void> {
  try {
    await gh(`/repos/${enc(repo)}/git/refs/heads/${enc(branch)}`, { method: "PATCH", body: { sha, force: false } });
  } catch (e) {
    if (status(e) === 422) throw new BuildError(`Someone pushed to ${branch} while PMA was building, so it didn't overwrite their work. Try again.`);
    throw e;
  }
}

export type OpenedPull = { number: number; html_url: string };

export async function openPullRequest(gh: Gh, repo: string, o: { title: string; head: string; base: string; body: string }): Promise<OpenedPull> {
  return gh<OpenedPull>(`/repos/${enc(repo)}/pulls`, { method: "POST", body: { title: o.title, head: o.head, base: o.base, body: o.body, maintainer_can_modify: true } });
}

/** The open pull request from `branch` in this repository, if there is one. */
export async function openPullFor(gh: Gh, repo: string, branch: string): Promise<OpenedPull | null> {
  const owner = repo.split("/")[0];
  const r = await gh<OpenedPull[]>(`/repos/${enc(repo)}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=1`);
  return r[0] ?? null;
}

/** "@someone" in text that came from feedback or a model would notify that person on GitHub: break the mention. */
export const quietMentions = (s: string) => s.replace(/(^|[^\w`])@(?=[A-Za-z0-9-])/g, "$1@​");

/** The pull request description: Claude's summary, how it was made, the task it was built from, and the PMA marker. */
export function pullRequestBody(o: { summary: string; task: string; issueUrl: string; short: string }): string {
  return [
    quietMentions(o.summary.trim()),
    "",
    "---",
    `Built by [PMA](${o.issueUrl}) with Claude from the approved mock-up. PMA never merges: review it like any other pull request. When it merges, the issue in PMA is marked shipped and the people who raised it are told.`,
    "",
    "<details><summary>The task PMA built from</summary>",
    "",
    quietMentions(o.task.trim()),
    "",
    "</details>",
    "",
    `PMA: ${o.short}`,
  ].join("\n");
}
