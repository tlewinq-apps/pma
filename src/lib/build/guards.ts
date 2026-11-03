// What Build it may write. Claude stages every change through write_file, and each one is checked here before it is
// kept: the content comes from a model that read customer feedback, so the rules never rely on it following them.
// Pure, so the agent, the committer and the tests share one set of rules.

export const MAX_FILES = 20;
/** A changed file's whole size (edit_file keeps the edit small, but the file it lands in can be big). */
export const MAX_FILE_BYTES = 400_000;
export const MAX_STAGED_BYTES = 1_200_000;

/** Lockfiles: a dependency change goes through the team's own install, never a hand-written lockfile. */
const LOCKFILES = new Set([
  "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock",
  "Gemfile.lock", "Podfile.lock", "Cargo.lock", "poetry.lock", "composer.lock", "go.sum", "uv.lock", "Pipfile.lock",
]);

/** Why `path` can't be written, as a sentence Claude reads back, or null when it may be. */
export function pathProblem(path: string): string | null {
  if (typeof path !== "string" || !path) return "Give the file's path inside the repository.";
  if (path.length > 300) return "That path is too long.";
  if (path.startsWith("/") || path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) return "Use a relative path inside the repository, with forward slashes.";
  const parts = path.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return "Use a plain path inside the repository, without . or .. segments.";
  const base = parts[parts.length - 1];
  if (parts[0] === ".github") return "Files under .github/ (workflows and repository settings) can't be changed by Build it.";
  if (parts[0] === ".git" || parts.includes("node_modules")) return "That folder can't be changed.";
  if (LOCKFILES.has(base)) return "Lockfiles can't be changed by Build it. If the change needs a new dependency, say so in your summary instead.";
  if (base === ".env" || base.startsWith(".env.")) return "Environment files can't be changed by Build it.";
  if (/\.(pem|key|p12|pfx|keystore|jks)$/i.test(base)) return "Key and certificate files can't be changed by Build it.";
  return null;
}

/** Why this write can't be staged (path, content, or the totals with it), or null when it can. */
export function writeProblem(path: string, content: string, staged: ReadonlyMap<string, string>): string | null {
  const p = pathProblem(path);
  if (p) return p;
  if (typeof content !== "string") return "Send the file's whole new content as text.";
  if (content.includes("\u0000")) return "Only text files can be written.";
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_FILE_BYTES) return `That file would be ${Math.round(bytes / 1000)} KB; Build it writes files up to ${MAX_FILE_BYTES / 1000} KB.`;
  if (!staged.has(path) && staged.size >= MAX_FILES) return `Build it changes at most ${MAX_FILES} files. Keep the change smaller.`;
  let total = bytes;
  for (const [k, v] of staged) if (k !== path) total += Buffer.byteLength(v, "utf8");
  if (total > MAX_STAGED_BYTES) return `The change would be over ${MAX_STAGED_BYTES / 1000} KB in all. Keep it smaller.`;
  return null;
}
