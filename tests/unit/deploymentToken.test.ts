// The deployment's GITHUB_TOKEN acts only for the demo app. Any company admin can point their own app at any public
// repository (POST /api/apps/[appId]/repo), so a customer app must never read, dispatch, merge or close anything with
// that token. Octokit is a spy here: every test that should not reach GitHub checks it was never called, and each has
// a demo-app control proving the spy is wired.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

const gh = vi.hoisted(() => ({
  getContent: vi.fn(),
  createReview: vi.fn(),
  merge: vi.fn(),
  update: vi.fn(),
  tables: {} as Record<string, unknown>,
  writes: [] as string[],
}));

vi.mock("@/lib/github/client", () => ({
  octokit: () => ({ repos: { getContent: gh.getContent }, pulls: { createReview: gh.createReview, merge: gh.merge, update: gh.update } }),
  splitRepo: (full: string) => { const [owner, repo] = full.split("/"); return { owner, repo }; },
}));

/** A Supabase stand-in: selects answer from gh.tables by table name, writes are recorded in gh.writes. */
function fakeDb() {
  const from = (table: string) => {
    const q = {
      select: () => q, eq: () => q, order: () => q, limit: () => q,
      single: async () => ({ data: gh.tables[table] ?? null, error: null }),
      maybeSingle: async () => ({ data: gh.tables[table] ?? null, error: null }),
      update: () => { gh.writes.push(`update ${table}`); return q; },
      insert: async () => { gh.writes.push(`insert ${table}`); return { error: null }; },
    };
    return q;
  };
  return { from };
}

vi.mock("@/lib/db/server", () => ({ serviceDb: () => fakeDb() }));
vi.mock("@/lib/slack/reporters", () => ({ tellReporters: async () => {} }));
vi.mock("@/lib/actions/solveAndDraft", () => ({ draftSolution: async () => true }));
vi.mock("@/lib/github/dispatch", () => ({ hasDraftInProgress: async () => false }));

import { readerFor } from "@/lib/marver/sync";
import { approveAndMerge } from "@/lib/actions/approve";
import { requestChanges } from "@/lib/actions/drafting";
import { clearGithubCache } from "@/lib/repo/githubTarball";
import type { SupabaseClient } from "@supabase/supabase-js";

const notFound = () => { throw Object.assign(new Error("Not Found"), { status: 404 }); };

/** A gzipped tar holding the given files under the codeload top folder. */
function tarball(files: Record<string, string>): Uint8Array<ArrayBuffer> {
  const parts: Buffer[] = [];
  for (const [name, text] of Object.entries(files)) {
    const body = Buffer.from(text);
    const h = Buffer.alloc(512);
    h.write(`repo-main/${name}`, 0);
    h.write("0000644\0", 100); h.write("0000000\0", 108); h.write("0000000\0", 116);
    h.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
    h.write("00000000000\0", 136); h.write("        ", 148); h.write("0", 156); h.write("ustar\0", 257); h.write("00", 263);
    let sum = 0; for (const b of h) sum += b;
    h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    parts.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  return new Uint8Array(gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)])));
}

let fetched: string[];
function stubFetch(routes: Record<string, () => Response>) {
  fetched = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    fetched.push(url);
    return routes[url]?.() ?? new Response("Not Found", { status: 404 });
  });
}

beforeEach(() => {
  for (const f of [gh.getContent, gh.createReview, gh.merge, gh.update]) f.mockReset();
  gh.getContent.mockImplementation(notFound);
  gh.createReview.mockResolvedValue({});
  gh.merge.mockResolvedValue({});
  gh.update.mockResolvedValue({});
  gh.tables = {};
  gh.writes = [];
  clearGithubCache();
  vi.stubEnv("GITHUB_TOKEN", "ghp_deployment_token_for_tests");
  vi.stubEnv("PMA_LOCAL_REPOS_DIR", path.join(tmpdir(), "pma-no-local-repos-here"));
  stubFetch({});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("readerFor", () => {
  const app = (kind: string) => ({ kind, repo_full_name: "acme/web", design_path: "design", watched_branch: "main" });

  it("never calls Octokit for a customer app, even with a repo and the deployment's token", async () => {
    const { reader, fromRepo } = readerFor(app("customer"));
    expect(fromRepo).toBe(true);
    expect(await reader.read("design/manifest.json")).toBeNull();
    expect(await reader.list("design/boards")).toEqual([]);
    expect(gh.getContent).not.toHaveBeenCalled();
  });

  it("reads a customer app's canvas through its repository snapshot (public tarball, no token)", async () => {
    stubFetch({ "https://codeload.github.com/acme/web/tar.gz/main": () => new Response(tarball({ "design/manifest.json": '{"frames":[]}', "design/boards/a.json": "{}", "design/boards/x/b.json": "{}" })) });
    const { reader } = readerFor(app("customer"));
    expect(await reader.read("design/manifest.json")).toBe('{"frames":[]}');
    expect(await reader.list("design/boards")).toEqual(["design/boards/a.json"]);
    expect(fetched).toEqual(["https://codeload.github.com/acme/web/tar.gz/main"]);
    expect(gh.getContent).not.toHaveBeenCalled();
  });

  it("gives a customer app with no repository no canvas at all (not the Celeste one)", async () => {
    const { reader, fromRepo } = readerFor({ kind: "customer", repo_full_name: null, design_path: "design", watched_branch: "main" });
    expect(fromRepo).toBe(false);
    expect(await reader.read("design/manifest.json")).toBeNull();
    expect(fetched).toEqual([]);
    expect(gh.getContent).not.toHaveBeenCalled();
  });

  it("control: the demo app reads its design repo through the token", async () => {
    const { reader } = readerFor(app("demo"));
    expect(await reader.read("design/manifest.json")).toBeNull();
    expect(gh.getContent).toHaveBeenCalledWith({ owner: "acme", repo: "web", path: "design/manifest.json", ref: "main" });
  });
});

describe("approveAndMerge", () => {
  const ISSUE = "11111111-1111-4111-8111-111111111111";
  const githubDraft = { id: "d1", status: "ready", demo: false, backend: "github", pr_number: 7, pr_state: "open", pr_url: "https://github.com/acme/web/pull/7" };

  it("never calls GitHub for a customer app's draft, and ships nothing", async () => {
    gh.tables = { issues: { id: ISSUE, projects: { repo_full_name: "acme/web", kind: "customer" } }, drafts: githubDraft };
    const r = await approveAndMerge(ISSUE, "u1");
    expect(r).toEqual({ ok: false, status: 409, error: "Drafts for this app can't be merged on GitHub yet." });
    expect(gh.createReview).not.toHaveBeenCalled();
    expect(gh.merge).not.toHaveBeenCalled();
    expect(gh.writes).toEqual([]);
  });

  it("control: the demo app's draft is approved and merged on GitHub", async () => {
    gh.tables = { issues: { id: ISSUE, projects: { repo_full_name: "acme/web", kind: "demo" } }, drafts: githubDraft };
    expect(await approveAndMerge(ISSUE, "u1")).toEqual({ ok: true });
    expect(gh.merge).toHaveBeenCalledWith({ owner: "acme", repo: "web", pull_number: 7, merge_method: "squash" });
  });
});

describe("requestChanges", () => {
  const ISSUE = "22222222-2222-4222-8222-222222222222";
  const prev = { id: "d1", status: "ready", solution_id: "s1", demo: false, backend: "github", pr_number: 7, pr_state: "open" };
  const db = () => fakeDb() as unknown as SupabaseClient;

  it("never closes a customer app's pull request with the deployment's token", async () => {
    gh.tables = { issues: { id: ISSUE, lane: "explore", projects: { repo_full_name: "acme/web", kind: "customer" } }, drafts: prev };
    expect(await requestChanges(db(), ISSUE, "u1", "make it bigger")).toEqual({ ok: true });
    expect(gh.update).not.toHaveBeenCalled();
  });

  it("control: the demo app's superseded pull request is closed", async () => {
    gh.tables = { issues: { id: ISSUE, lane: "explore", projects: { repo_full_name: "acme/web", kind: "demo" } }, drafts: prev };
    expect(await requestChanges(db(), ISSUE, "u1", "make it bigger")).toEqual({ ok: true });
    expect(gh.update).toHaveBeenCalledWith({ owner: "acme", repo: "web", pull_number: 7, state: "closed" });
  });
});
