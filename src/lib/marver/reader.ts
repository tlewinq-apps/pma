// Where a design canvas's files come from: the connected GitHub repo, or the built-in Celeste fixture.
import { octokit, splitRepo } from "@/lib/github/client";
import { decodeFileResponse, isNotFound } from "@/lib/github/file";
import { FIXTURE_DESIGN } from "./fixture.generated";
import { openRepo, type RepoSnapshot } from "@/lib/repo/snapshot";

export type DesignReader = {
  label: string;
  read(path: string): Promise<string | null>;
  /** The file paths directly inside `dir` (no subfolders). Empty when the folder doesn't exist. */
  list(dir: string): Promise<string[]>;
};

/**
 * A canvas read through the app's repository snapshot (openRepo: a dev checkout, or a public repo with no token), for
 * customer apps, which never use the deployment's token. The snapshot is opened on the first read. With no repository,
 * or no canvas in it, every read is null and every folder empty, so the app simply has no Marver screens.
 */
export function snapshotReader(p: { repo_full_name: string | null; watched_branch: string | null; org_id?: string | null }): DesignReader {
  let snap: Promise<RepoSnapshot | null> | null = null;
  const open = () => (snap ??= openRepo(p));
  return {
    label: p.repo_full_name ? `${p.repo_full_name} on ${p.watched_branch ?? "its default branch"}` : "this app (no repository connected)",
    async read(path) {
      return (await open())?.read(path) ?? null;
    },
    async list(dir) {
      const s = await open();
      const prefix = `${dir.replace(/\/+$/, "")}/`;
      return s ? s.files().map((f) => f.path).filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes("/")) : [];
    },
  };
}

/** A file at `ref` in the design repo. Null only when it does not exist (404); every other failure throws. */
export function githubReader(repo: string, ref: string): DesignReader {
  const fail = (path: string, e: unknown) => {
    const status = (e as { status?: number })?.status ?? "unknown";
    return new Error(`GitHub error reading ${path} (status ${status}): ${(e as Error)?.message ?? e}`);
  };
  return {
    label: `${repo} on ${ref}`,
    async read(path) {
      let data: unknown;
      try {
        data = (await octokit().repos.getContent({ ...splitRepo(repo), path, ref })).data;
      } catch (e) {
        if (isNotFound(e)) return null;
        throw fail(path, e);
      }
      return decodeFileResponse(path, data);
    },
    async list(dir) {
      try {
        const { data } = await octokit().repos.getContent({ ...splitRepo(repo), path: dir, ref });
        return Array.isArray(data) ? data.filter((f) => f.type === "file").map((f) => f.path) : [];
      } catch (e) {
        if (isNotFound(e)) return [];
        throw fail(dir, e);
      }
    },
  };
}

/** The bundled Celeste canvas (demo/celeste-design, packed by `npm run design:pack`). */
export function fixtureReader(): DesignReader {
  return {
    label: "the built-in sample design",
    read: async (path) => FIXTURE_DESIGN[path] ?? null,
    list: async (dir) => Object.keys(FIXTURE_DESIGN).filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes("/")),
  };
}
