// A repository checked out under .local-repos/<owner>/<name>, for development: it lets a private repo be read before
// the PMA GitHub App exists, by cloning it with your own gh login. Off in production unless PMA_LOCAL_REPOS=1.
// Every path resolves inside the folder; "..", absolute paths and symlinks that point out are refused.
import fs from "node:fs";
import path from "node:path";
import type { RepoFile, RepoSnapshot } from "./snapshot";
import { isSkippedDir, isSourcePath, looksBinary, MAX_FILE_BYTES, MAX_FILES } from "./files";

/** A repository path that would leave the local repositories folder. */
export class RepoPathError extends Error {
  constructor(message = "That path leaves the local repositories folder, so PMA won't read it.") {
    super(message);
    this.name = "RepoPathError";
  }
}

export function localReposEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.PMA_LOCAL_REPOS === "1";
}

export function localReposRoot(): string {
  return process.env.PMA_LOCAL_REPOS_DIR ?? path.join(process.cwd(), ".local-repos");
}

const realOrNull = (p: string): string | null => {
  try { return fs.realpathSync(p); } catch { return null; }
};

const inside = (root: string, p: string) => p === root || p.startsWith(root + path.sep);

/**
 * Resolves `p` (already under `root` by construction) through symlinks and requires the result to stay inside `root`.
 * A path that does not exist is checked through its nearest existing parent, so a symlinked owner folder pointing out
 * is refused even when the repo inside it is missing. Returns the real path, or null when it does not exist.
 */
function realInside(root: string, p: string): string | null {
  for (let cur = p; ; cur = path.dirname(cur)) {
    const real = realOrNull(cur);
    if (real) {
      if (!inside(root, real)) throw new RepoPathError();
      return cur === p ? real : null;
    }
    if (cur === root || path.dirname(cur) === cur) return null;
  }
}

/**
 * The checkout folder for `owner/name`, or null when local repos are off, the folder is missing or isn't a folder.
 * Throws RepoPathError for input that is absolute or has "." or ".." parts, and for a folder that symlinks outside.
 */
export function localRepoDir(repo: string): string | null {
  const parts = repo.split(/[\\/]/);
  if (path.isAbsolute(repo) || /^[a-zA-Z]:/.test(repo) || parts.some((p) => p === "" || p === "." || p === "..")) throw new RepoPathError();
  if (!localReposEnabled()) return null;
  const root = realOrNull(localReposRoot());
  if (!root) return null;
  const target = path.resolve(root, ...parts);
  if (!inside(root, target)) throw new RepoPathError();
  const real = realInside(root, target);
  if (!real || real === root) return null;
  // A runtime folder (dev only), never part of the build: the ignore comment keeps the bundler from tracing the whole project.
  return fs.statSync(/*turbopackIgnore: true*/ real).isDirectory() ? real : null;
}

/** The branch a checkout is on, from .git/HEAD ("ref: refs/heads/<branch>"); "main" when there is no .git or HEAD is detached. */
export function localBranch(dir: string): string {
  try {
    const head = fs.readFileSync(path.join(dir, ".git", "HEAD"), "utf8").trim();
    const m = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    if (m) return m[1];
  } catch { /* no .git folder (or a worktree's .git file) */ }
  return "main";
}

/** Walks the checkout, never following symlinks, skipping dependency and build folders; source files only, capped. */
function listFiles(dir: string): { files: RepoFile[]; truncated: boolean } {
  const files: RepoFile[] = [];
  const stack = [""];
  while (stack.length) {
    const rel = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0)); // reversed, so the stack pops in order
    const subdirs: string[] = [];
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (!isSkippedDir(p)) subdirs.push(p); continue; }
      if (!e.isFile() || !isSourcePath(p)) continue;
      let size: number;
      try { size = fs.lstatSync(path.join(dir, p)).size; } catch { continue; }
      if (size > MAX_FILE_BYTES) continue;
      if (files.length >= MAX_FILES) return { files: files.sort(byPath), truncated: true };
      files.push({ path: p, size });
    }
    stack.push(...subdirs);
  }
  return { files: files.sort(byPath), truncated: false };
}

const byPath = (a: RepoFile, b: RepoFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** A snapshot of the checkout's working tree. `read` only opens listed files, and re-checks each one is still inside. */
export function localSnapshot(repo: string, dir: string, ref: string): RepoSnapshot {
  const { files, truncated } = listFiles(dir);
  const listed = new Set(files.map((f) => f.path));
  return {
    repo, ref, source: "local", truncated,
    files: () => files.slice(),
    read(p: string): string | null {
      if (!listed.has(p)) return null;
      try {
        const full = fs.realpathSync(path.join(dir, p));
        if (!inside(dir, full)) return null;
        const stat = fs.statSync(full);
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
        const bytes = fs.readFileSync(full);
        return looksBinary(bytes) ? null : bytes.toString("utf8");
      } catch {
        return null;
      }
    },
  };
}
