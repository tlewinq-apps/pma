// POST/DELETE /api/apps/[appId]/repo: connect or disconnect the app's repository. The checks run in order (outsider 404,
// member 403, owner/name shape, readable), and only then does the service role write repo_full_name, which signed-in
// users can't update themselves (0018). GitHub is never called for real: fetch is stubbed per test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

const h = vi.hoisted(() => ({
  ctx: null as null | { role: "owner" | "admin" | "member"; org: { id: string }; project: { id: string; kind?: string } },
  updates: [] as { table: string; values: Record<string, unknown>; id: unknown }[],
  updateError: null as null | { message: string },
}));

vi.mock("@/lib/db/app", () => ({
  appById: async () => h.ctx,
  hasRole: (ctx: { role: string }, roles: string[]) => roles.includes(ctx.role),
}));
vi.mock("@/lib/db/server", () => ({
  serviceDb: () => ({
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => ({
        eq: async (_col: string, id: unknown) => { h.updates.push({ table, values, id }); return { error: h.updateError }; },
      }),
    }),
  }),
}));

import { POST, DELETE } from "@/app/api/apps/[appId]/repo/route";
import { clearGithubCache } from "@/lib/repo/githubTarball";

const APP = "e5123994-2425-4415-8d88-105b998592b2";
const params = { params: Promise.resolve({ appId: APP }) };
const post = (body: unknown) => POST(new Request(`http://x/api/apps/${APP}/repo`, { method: "POST", body: JSON.stringify(body) }), params);
const del = () => DELETE(new Request(`http://x/api/apps/${APP}/repo`, { method: "DELETE" }), params);

/** A gzipped tar with one source file under the codeload top folder. */
function tarball(): Buffer {
  const body = Buffer.from("export const A = 1;\n");
  const hd = Buffer.alloc(512);
  hd.write("next.js-canary/src/a.tsx", 0);
  hd.write("0000644\0", 100); hd.write("0000000\0", 108); hd.write("0000000\0", 116);
  hd.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
  hd.write("00000000000\0", 136); hd.write("        ", 148); hd.write("0", 156); hd.write("ustar\0", 257); hd.write("00", 263);
  let sum = 0; for (const b of hd) sum += b;
  hd.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return gzipSync(Buffer.concat([hd, body, Buffer.alloc(512 - body.length), Buffer.alloc(1024)]));
}

let calls: string[];
function stubFetch(routes: Record<string, () => Response>) {
  calls = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return routes[url]?.() ?? new Response("Not Found", { status: 404 });
  });
}

const NEXT_API = "https://api.github.com/repos/vercel/next.js";
const NEXT_TAR = "https://codeload.github.com/vercel/next.js/tar.gz/canary";
const publicNext = () => stubFetch({
  [NEXT_API]: () => Response.json({ full_name: "vercel/next.js", default_branch: "canary" }),
  [NEXT_TAR]: () => new Response(new Uint8Array(tarball()), { status: 200 }),
});

beforeEach(() => {
  h.ctx = { role: "admin", org: { id: "org-1" }, project: { id: APP } };
  h.updates = [];
  h.updateError = null;
  clearGithubCache();
  vi.stubEnv("PMA_LOCAL_REPOS_DIR", path.join(tmpdir(), "pma-no-local-repos-here"));
  stubFetch({});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/apps/[appId]/repo", () => {
  it("is a 404 for someone outside the company, before anything else", async () => {
    h.ctx = null;
    const res = await post({ repo: "vercel/next.js" });
    expect(res.status).toBe(404);
    expect(calls).toEqual([]);
    expect(h.updates).toEqual([]);
  });

  it("is a 403 for a plain member", async () => {
    h.ctx = { role: "member", org: { id: "org-1" }, project: { id: APP } };
    const res = await post({ repo: "vercel/next.js" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Only company owners and admins can change this.");
    expect(calls).toEqual([]);
    expect(h.updates).toEqual([]);
  });

  it("refuses the demo app with a 409 for its owner and admins: PMA manages that repository", async () => {
    publicNext();
    for (const role of ["owner", "admin"] as const) {
      h.ctx = { role, org: { id: "org-1" }, project: { id: APP, kind: "demo" } };
      const res = await post({ repo: "vercel/next.js" });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "The demo app's repository is managed by PMA." });
    }
    expect(calls).toEqual([]);
    expect(h.updates).toEqual([]);
    // A member of the demo company still gets the member answer first.
    h.ctx = { role: "member", org: { id: "org-1" }, project: { id: APP, kind: "demo" } };
    expect((await post({ repo: "vercel/next.js" })).status).toBe(403);
  });

  it("refuses a malformed repo or branch with a sentence, before calling GitHub", async () => {
    for (const body of [{ repo: "bad" }, { repo: "a/b/c" }, {}, { repo: 42 }, null]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json()).error).toBe("Use owner/name, for example acme/web-app.");
    }
    for (const branch of ["../x", "a..b", "/main", "main/", "x.lock", "a b", 7]) {
      const res = await post({ repo: "vercel/next.js", branch });
      expect(res.status, String(branch)).toBe(400);
      expect((await res.json()).error).toBe("That isn't a valid branch name.");
    }
    expect(calls).toEqual([]);
    expect(h.updates).toEqual([]);
  });

  it("connects a public repo with no token, at its default branch, and saves both with the service role", async () => {
    publicNext();
    const res = await post({ repo: " vercel/next.js ", branch: "" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, repo: "vercel/next.js", ref: "canary", files: 1 });
    expect(h.updates).toEqual([{ table: "projects", values: { repo_full_name: "vercel/next.js", watched_branch: "canary" }, id: APP }]);
    expect(calls).toEqual([NEXT_API, NEXT_TAR]);
  });

  it("keeps a branch it was given", async () => {
    publicNext();
    const res = await post({ repo: "vercel/next.js", branch: "canary" });
    expect(await res.json()).toEqual({ ok: true, repo: "vercel/next.js", ref: "canary", files: 1 });
    expect(calls).toEqual([NEXT_TAR]);
  });

  it("says a private (or unknown) repository connects through Connect with GitHub, and saves nothing", async () => {
    const res = await post({ repo: "acme/definitely-not-a-repo-xyz" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "PMA can't read that repository. If it's private, use Connect with GitHub and give the PMA app access to it.",
      code: "repo_private",
    });
    expect(h.updates).toEqual([]);
  });

  it("says the branch doesn't exist when the repo is public", async () => {
    publicNext();
    const res = await post({ repo: "vercel/next.js", branch: "no-such-branch" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That repository or branch doesn't exist.", code: "repo_missing" });
    expect(h.updates).toEqual([]);
  });

  it("answers 502 with a sentence when GitHub can't be reached", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("fetch failed"); });
    const res = await post({ repo: "vercel/next.js" });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("PMA couldn't reach GitHub just now. Try again in a minute.");
    expect(h.updates).toEqual([]);
  });

  it("reads a local checkout in dev without calling GitHub", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "pma-route-repos-"));
    try {
      mkdirSync(path.join(root, "acme", "Closet.", "app"), { recursive: true });
      mkdirSync(path.join(root, "acme", "Closet.", ".git"), { recursive: true });
      writeFileSync(path.join(root, "acme", "Closet.", "app", "index.tsx"), "export default function Home() { return null; }\n");
      writeFileSync(path.join(root, "acme", "Closet.", ".git", "HEAD"), "ref: refs/heads/main\n");
      vi.stubEnv("PMA_LOCAL_REPOS_DIR", root);
      const res = await post({ repo: "acme/Closet." });
      expect(await res.json()).toEqual({ ok: true, repo: "acme/Closet.", ref: "main", files: 1 });
      expect(calls).toEqual([]);
      expect(h.updates[0].values).toEqual({ repo_full_name: "acme/Closet.", watched_branch: "main" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("answers 500 with a sentence when the save fails", async () => {
    publicNext();
    h.updateError = { message: "boom" };
    const res = await post({ repo: "vercel/next.js" });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Couldn't save the repository. Try again.");
  });
});

describe("DELETE /api/apps/[appId]/repo", () => {
  it("is a 404 for an outsider and a 403 for a member, and writes nothing", async () => {
    h.ctx = null;
    expect((await del()).status).toBe(404);
    h.ctx = { role: "member", org: { id: "org-1" }, project: { id: APP } };
    expect((await del()).status).toBe(403);
    expect(h.updates).toEqual([]);
  });

  it("never disconnects the demo app's repository (409), and writes nothing", async () => {
    for (const role of ["owner", "admin"] as const) {
      h.ctx = { role, org: { id: "org-1" }, project: { id: APP, kind: "demo" } };
      const res = await del();
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("The demo app's repository is managed by PMA.");
    }
    expect(h.updates).toEqual([]);
  });

  it("clears the repository for an owner or admin", async () => {
    for (const role of ["owner", "admin"] as const) {
      h.ctx = { role, org: { id: "org-1" }, project: { id: APP } };
      h.updates = [];
      const res = await del();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(h.updates).toEqual([{ table: "projects", values: { repo_full_name: null }, id: APP }]);
    }
  });
});
