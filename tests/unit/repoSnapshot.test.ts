// The repository reading layer: one RepoSnapshot (files() and read()) over a dev-only local checkout and over a public
// GitHub repo's tarball. No test touches the network: fetch is injected, and the tarball is built here, header by header.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { isSourcePath } from "@/lib/repo/files";
import { localRepoDir, RepoPathError } from "@/lib/repo/localDir";
import { clearGithubCache, githubSnapshot, RepoFetchError } from "@/lib/repo/githubTarball";
import { connectRepoProblem, openRepo, REPO_MESSAGES, unreadableReason } from "@/lib/repo/snapshot";

// ---- a tarball, built by hand ---------------------------------------------------------------------------------------

/** One 512-byte ustar header with a valid checksum. */
function header(name: string, size: number, type: string, prefix = ""): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "utf8");
  h.write("0000644\0", 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
  h.write("00000000000\0", 136);
  h.write("        ", 148);
  if (type !== "\0") h.write(type, 156);
  h.write("ustar\0", 257);
  h.write("00", 263);
  if (prefix) h.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return h;
}

const pad = (n: number) => Buffer.alloc((512 - (n % 512)) % 512);

function entry(name: string, body: Buffer | string, type = "0", prefix = ""): Buffer {
  const b = Buffer.from(body);
  return Buffer.concat([header(name, b.length, type, prefix), b, pad(b.length)]);
}

/** A pax extended header body: "<len> key=value\n", where len counts the whole record. */
function paxBody(records: Record<string, string>): Buffer {
  return Buffer.concat(Object.entries(records).map(([k, v]) => {
    const base = Buffer.byteLength(` ${k}=${v}\n`);
    let len = base + String(base).length;
    if (String(len).length !== String(base).length) len = base + String(len).length;
    return Buffer.from(`${len} ${k}=${v}\n`);
  }));
}

const tarGz = (parts: Buffer[]) => gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));

const LONG_DIR = "very-long-folder-name/".repeat(5);
const BINARY = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0x0d, 1, 2, 3]);

/** What `git archive` (and so codeload) writes: a global pax header, then everything under "<repo>-<ref>/". */
function closetTarball(top = "Closet.-main"): Buffer {
  return tarGz([
    entry("pax_global_header", paxBody({ comment: "0123456789abcdef0123456789abcdef01234567" }), "g"),
    entry(`${top}/`, "", "5"),
    entry(`${top}/src/a.tsx`, "export const A = 1;\n"),
    entry(`${top}/node_modules/x.js`, "module.exports = 1;\n"),
    entry(`${top}/img.png`, BINARY),
    entry(`${top}/package-lock.json`, "{}\n"),
    entry(`${top}/big.ts`, "x".repeat(500 * 1024)),
    entry(`${top}/src/blob.js`, Buffer.concat([Buffer.from("var a = 1;"), BINARY])),
    entry(`${top}/vendor.min.js`, "!function(){}();\n"),
    // A GNU long name: the real path rides in an "L" entry before the file.
    entry("././@LongLink", `${top}/src/${LONG_DIR}deep.tsx\0`, "L"),
    entry(`${top}/src/${LONG_DIR}`.slice(0, 99), "export const Deep = 2;\n"),
    // A pax path, as git archive writes for paths with spaces or non-ASCII.
    entry("PaxHeaders/x", paxBody({ path: `${top}/app/(tabs)/look viewer.tsx`, mtime: "0" }), "x"),
    entry(`${top}/app/(tabs)/look-v`, "export function LookViewer() { return null; }\n"),
    // The ustar prefix field, and a regular file typed "\0" (old tar).
    entry("b.css", ".look { overflow: auto; }\n", "0", `${top}/styles`),
    entry(`${top}/old.js`, "var old = 1;\n", "\0"),
    // A symlink entry is never a file.
    entry(`${top}/link.ts`, "", "2"),
  ]);
}

const CLOSET_FILES = ["app/(tabs)/look viewer.tsx", "old.js", "src/a.tsx", `src/${LONG_DIR}deep.tsx`, "styles/b.css"];

type FakeFetch = typeof fetch & { calls: string[] };

/** A fetch that answers from a table of URLs (404 for anything else) and records every URL it was asked for. */
function fakeFetch(routes: Record<string, () => Response | Promise<Response>>): FakeFetch {
  const calls: string[] = [];
  const f = async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const r = routes[url];
    return r ? r() : new Response("Not Found", { status: 404 });
  };
  return Object.assign(f, { calls }) as FakeFetch;
}

const tarResponse = (gz: Buffer) => () => new Response(new Uint8Array(gz), { status: 200, headers: { "content-type": "application/x-gzip" } });
const json = (v: unknown) => () => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
const noNetwork = (async () => { throw new Error("no network in this test"); }) as unknown as typeof fetch;

// ---- source filters -------------------------------------------------------------------------------------------------

describe("isSourcePath", () => {
  it("keeps code, markup and styles", () => {
    for (const p of ["src/a.tsx", "app/index.ts", "lib/x.js", "web/page.jsx", "a.mjs", "server.py", "main.go", "App.swift",
      "MainActivity.kt", "index.html", "Page.vue", "Card.svelte", "page.astro", "styles/app.css", "theme.scss", "app.json", "README.md"]) {
      expect(isSourcePath(p), p).toBe(true);
    }
  });
  it("drops dependencies, build output, lockfiles, minified files, images, fonts and binaries", () => {
    for (const p of ["node_modules/x.js", "a/node_modules/b/c.ts", "dist/index.js", "build/app.js", ".next/server/page.js",
      ".expo/web/cache.js", "ios/Pods/Foo/foo.m", "android/build/gen.java", "android/app/build/x.kt", ".git/config",
      "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "ios/Podfile.lock", "vendor.min.js", "app.min.css",
      "img.png", "photo.JPG", "icon.svg", "font.woff2", "font.ttf", "app.wasm", "archive.zip", "doc.pdf", "Makefile", ".env", ".env.local"]) {
      expect(isSourcePath(p), p).toBe(false);
    }
  });
});

// ---- the owner/name check -------------------------------------------------------------------------------------------

describe("connectRepoProblem", () => {
  it("accepts owner/name with letters, digits, dot, underscore and dash in each part", () => {
    expect(connectRepoProblem("acme/Closet.")).toBeNull();
    expect(connectRepoProblem("vercel/next.js")).toBeNull();
    expect(connectRepoProblem("a_b/c-d.e")).toBeNull();
  });
  it("refuses anything else", () => {
    for (const r of ["bad", "a/b/c", "", "/abs", "a/", "/b", "../etc", "a/..", "./x", "a b/c", "a/b?c", "a/b#c", "a\\b"]) {
      expect(connectRepoProblem(r), r).toBe("repo_invalid");
    }
  });
  it("says each problem in a plain sentence", () => {
    expect(REPO_MESSAGES.repo_invalid).toBe("Use owner/name, for example acme/web-app.");
    expect(REPO_MESSAGES.repo_private).toBe("PMA can't read that repository. If it's private, use Connect with GitHub and give the PMA app access to it.");
    expect(REPO_MESSAGES.repo_missing).toBe("That repository or branch doesn't exist.");
  });
});

// ---- local checkouts ------------------------------------------------------------------------------------------------

describe("local checkouts under .local-repos", () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "pma-local-repos-"));
    outside = mkdtempSync(path.join(tmpdir(), "pma-outside-"));
    vi.stubEnv("PMA_LOCAL_REPOS_DIR", root);
    const repo = path.join(root, "acme", "web");
    mkdirSync(path.join(repo, "src"), { recursive: true });
    mkdirSync(path.join(repo, "node_modules"), { recursive: true });
    mkdirSync(path.join(repo, ".git"), { recursive: true });
    writeFileSync(path.join(repo, "src", "a.tsx"), "export const A = 1;\n");
    writeFileSync(path.join(repo, "node_modules", "x.js"), "module.exports = 1;\n");
    writeFileSync(path.join(repo, "img.png"), BINARY);
    writeFileSync(path.join(repo, "big.ts"), "x".repeat(500 * 1024));
    writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/trunk\n");
    writeFileSync(path.join(repo, ".git", "config.json"), "{}\n");
    writeFileSync(path.join(outside, "secret.ts"), "export const SECRET = 'nope';\n");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("lists only source files, and reads them", async () => {
    const snap = await openRepo({ repo_full_name: "acme/web", watched_branch: null }, { fetch: noNetwork });
    expect(snap).not.toBeNull();
    expect(snap!.source).toBe("local");
    expect(snap!.repo).toBe("acme/web");
    expect(snap!.files()).toEqual([{ path: "src/a.tsx", size: 20 }]);
    expect(snap!.read("src/a.tsx")).toBe("export const A = 1;\n");
    for (const p of ["node_modules/x.js", "img.png", "big.ts", ".git/HEAD", "nope.ts", "../acme/web/src/a.tsx"]) expect(snap!.read(p), p).toBeNull();
  });

  it("reads the checked-out branch from .git/HEAD when no branch is set, and keeps a set branch", async () => {
    expect((await openRepo({ repo_full_name: "acme/web", watched_branch: null }, { fetch: noNetwork }))!.ref).toBe("trunk");
    expect((await openRepo({ repo_full_name: "acme/web", watched_branch: "release" }, { fetch: noNetwork }))!.ref).toBe("release");
    rmSync(path.join(root, "acme", "web", ".git"), { recursive: true });
    expect((await openRepo({ repo_full_name: "acme/web", watched_branch: null }, { fetch: noNetwork }))!.ref).toBe("main");
  });

  it("is null for a missing folder, and when local repos are off (production without PMA_LOCAL_REPOS=1)", () => {
    expect(localRepoDir("acme/web")).not.toBeNull();
    expect(localRepoDir("acme/nothing-here")).toBeNull();
    vi.stubEnv("NODE_ENV", "production");
    expect(localRepoDir("acme/web")).toBeNull();
    vi.stubEnv("PMA_LOCAL_REPOS", "1");
    expect(localRepoDir("acme/web")).not.toBeNull();
  });

  it("refuses paths that leave the folder: .., absolute paths and symlinks out", () => {
    expect(() => localRepoDir("../etc")).toThrow(RepoPathError);
    expect(() => localRepoDir("/abs")).toThrow(RepoPathError);
    expect(() => localRepoDir("acme/..")).toThrow(RepoPathError);
    symlinkSync(outside, path.join(root, "acme", "evil"));
    expect(() => localRepoDir("acme/evil")).toThrow(RepoPathError);
    symlinkSync(outside, path.join(root, "sneaky"));
    expect(() => localRepoDir("sneaky/x")).toThrow(RepoPathError);
  });

  it("never lists or reads through a symlink inside the checkout", async () => {
    symlinkSync(path.join(outside, "secret.ts"), path.join(root, "acme", "web", "src", "leak.ts"));
    symlinkSync(outside, path.join(root, "acme", "web", "src", "linked"));
    const snap = await openRepo({ repo_full_name: "acme/web", watched_branch: null }, { fetch: noNetwork });
    expect(snap!.files().map((f) => f.path)).toEqual(["src/a.tsx"]);
    expect(snap!.read("src/leak.ts")).toBeNull();
    expect(snap!.read("src/linked/secret.ts")).toBeNull();
  });

  it("tries the local checkout first and never calls GitHub for it", async () => {
    const f = fakeFetch({});
    const snap = await openRepo({ repo_full_name: "acme/web", watched_branch: "main" }, { fetch: f });
    expect(snap!.source).toBe("local");
    expect(f.calls).toEqual([]);
  });
});

// ---- public GitHub repos --------------------------------------------------------------------------------------------

describe("public GitHub repos, from the codeload tarball", () => {
  const TAR_URL = "https://codeload.github.com/acme/Closet./tar.gz/main";

  beforeEach(() => {
    clearGithubCache();
    // No local checkout can answer for these repos.
    vi.stubEnv("PMA_LOCAL_REPOS_DIR", path.join(tmpdir(), "pma-no-local-repos-here"));
  });
  afterEach(() => vi.unstubAllEnvs());

  it("strips the top folder, applies the filters and reads files", async () => {
    const f = fakeFetch({ [TAR_URL]: tarResponse(closetTarball()) });
    const snap = await githubSnapshot("acme/Closet.", "main", { fetch: f });
    expect(f.calls).toEqual([TAR_URL]);
    expect(snap).not.toBeNull();
    expect(snap!.source).toBe("github");
    expect(snap!.ref).toBe("main");
    expect(snap!.files().map((x) => x.path)).toEqual(CLOSET_FILES);
    expect(snap!.files().find((x) => x.path === "src/a.tsx")).toEqual({ path: "src/a.tsx", size: 20 });
    expect(snap!.read("src/a.tsx")).toBe("export const A = 1;\n");
    expect(snap!.read("app/(tabs)/look viewer.tsx")).toContain("LookViewer");
    expect(snap!.read(`src/${LONG_DIR}deep.tsx`)).toBe("export const Deep = 2;\n");
    expect(snap!.read("styles/b.css")).toContain("overflow");
    for (const p of ["src/blob.js", "big.ts", "img.png", "node_modules/x.js", "package-lock.json", "vendor.min.js", "link.ts", "nope.ts"]) expect(snap!.read(p), p).toBeNull();
  });

  it("caches the parsed snapshot per repo@ref", async () => {
    const f = fakeFetch({ [TAR_URL]: tarResponse(closetTarball()) });
    const a = await githubSnapshot("acme/Closet.", "main", { fetch: f });
    const b = await githubSnapshot("acme/Closet.", "main", { fetch: f });
    expect(b).toBe(a);
    expect(f.calls).toHaveLength(1);
  });

  it("keeps only the newest snapshots in memory", async () => {
    const routes = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`https://codeload.github.com/acme/r${i}/tar.gz/main`, tarResponse(closetTarball(`r${i}-main`))]));
    const f = fakeFetch(routes);
    for (let i = 0; i < 8; i++) await githubSnapshot(`acme/r${i}`, "main", { fetch: f });
    await githubSnapshot("acme/r7", "main", { fetch: f });
    expect(f.calls).toHaveLength(8);
    await githubSnapshot("acme/r0", "main", { fetch: f });
    expect(f.calls).toHaveLength(9);
  });

  it("is null when codeload has no such repo or ref, and that is not cached", async () => {
    const f = fakeFetch({});
    expect(await githubSnapshot("acme/definitely-not-a-repo-xyz", "main", { fetch: f })).toBeNull();
    expect(await githubSnapshot("acme/definitely-not-a-repo-xyz", "main", { fetch: f })).toBeNull();
    expect(f.calls).toHaveLength(2);
  });

  it("stops at the file cap and says the snapshot is partial", async () => {
    const f = fakeFetch({ [TAR_URL]: tarResponse(closetTarball()) });
    const snap = await githubSnapshot("acme/Closet.", "main", { fetch: f, maxFiles: 2 });
    expect(snap!.files()).toHaveLength(2);
    expect(snap!.truncated).toBe(true);
  });

  it("stops before the kept source passes the memory cap", async () => {
    const f = fakeFetch({ [TAR_URL]: tarResponse(closetTarball()) });
    // In tar order the first kept files are src/a.tsx (20 bytes) and the long-named deep.tsx (23 bytes).
    const snap = await githubSnapshot("acme/Closet.", "main", { fetch: f, maxSourceBytes: 50 });
    expect(snap!.files().map((x) => x.path)).toEqual(["src/a.tsx", `src/${LONG_DIR}deep.tsx`]);
    expect(snap!.truncated).toBe(true);
  });

  it("stops at the download cap and keeps what it read", async () => {
    const parts = [entry("r-main/a.ts", "export const a = 1;\n"), ...Array.from({ length: 40 }, (_, i) => entry(`r-main/f${i}.ts`, `export const v${i} = "${Math.random().toString(36).repeat(40)}";\n`))];
    const gz = tarGz(parts);
    // Arrives in small chunks, as a network body would.
    const body = () => new Response(new ReadableStream({
      start(c) { for (let i = 0; i < gz.length; i += 256) c.enqueue(new Uint8Array(gz.subarray(i, i + 256))); c.close(); },
    }), { status: 200 });
    const f = fakeFetch({ "https://codeload.github.com/acme/r/tar.gz/main": body });
    const snap = await githubSnapshot("acme/r", "main", { fetch: f, maxBytes: Math.floor(gz.length / 2) });
    expect(snap!.truncated).toBe(true);
    expect(snap!.files().length).toBeGreaterThan(0);
    expect(snap!.files().length).toBeLessThan(41);
    expect(snap!.read("a.ts")).toBe("export const a = 1;\n");
  });

  it("turns a network failure or a GitHub error into a RepoFetchError", async () => {
    await expect(githubSnapshot("acme/r", "main", { fetch: noNetwork })).rejects.toBeInstanceOf(RepoFetchError);
    const down = fakeFetch({ "https://codeload.github.com/acme/r/tar.gz/main": () => new Response("busy", { status: 503 }) });
    await expect(githubSnapshot("acme/r", "main", { fetch: down })).rejects.toBeInstanceOf(RepoFetchError);
  });

  it("encodes a branch with slashes segment by segment", async () => {
    const url = "https://codeload.github.com/acme/Closet./tar.gz/feature/look%232";
    const f = fakeFetch({ [url]: tarResponse(closetTarball("Closet.-feature-look-2")) });
    const snap = await githubSnapshot("acme/Closet.", "feature/look#2", { fetch: f });
    expect(f.calls).toEqual([url]);
    expect(snap!.files().map((x) => x.path)).toEqual(CLOSET_FILES);
  });

  it("openRepo reads the default branch from the public API when no branch is set", async () => {
    const f = fakeFetch({
      "https://api.github.com/repos/vercel/next.js": json({ full_name: "vercel/next.js", default_branch: "canary" }),
      "https://codeload.github.com/vercel/next.js/tar.gz/canary": tarResponse(closetTarball("next.js-canary")),
    });
    const snap = await openRepo({ repo_full_name: "vercel/next.js", watched_branch: null }, { fetch: f });
    expect(snap!.ref).toBe("canary");
    expect(snap!.source).toBe("github");
    expect(snap!.files().map((x) => x.path)).toEqual(CLOSET_FILES);
  });

  it("openRepo uses a set branch without asking the API, and is null when the repo can't be read", async () => {
    const f = fakeFetch({ [TAR_URL]: tarResponse(closetTarball()) });
    expect((await openRepo({ repo_full_name: "acme/Closet.", watched_branch: "main" }, { fetch: f }))!.ref).toBe("main");
    expect(f.calls).toEqual([TAR_URL]);
    expect(await openRepo({ repo_full_name: "acme/definitely-not-a-repo-xyz", watched_branch: null }, { fetch: f })).toBeNull();
    expect(await openRepo({ repo_full_name: null, watched_branch: "main" }, { fetch: f })).toBeNull();
    expect(await openRepo({ repo_full_name: "../etc", watched_branch: "main" }, { fetch: f })).toBeNull();
  });

  it("unreadableReason: missing when the public API sees the repo (so the ref is wrong), private otherwise", async () => {
    const f = fakeFetch({ "https://api.github.com/repos/vercel/next.js": json({ default_branch: "canary" }) });
    expect(await unreadableReason("vercel/next.js", { fetch: f })).toBe("repo_missing");
    expect(await unreadableReason("acme/definitely-not-a-repo-xyz", { fetch: f })).toBe("repo_private");
    await expect(unreadableReason("acme/r", { fetch: noNetwork })).rejects.toBeInstanceOf(RepoFetchError);
  });
});

// ---- reading as a company's GitHub installation ---------------------------------------------------------------------

describe("a company's GitHub installation token", () => {
  beforeEach(() => clearGithubCache());

  /** Like fakeFetch, and also records the Authorization header each URL was asked with. */
  function authFetch(routes: Record<string, (auth: string | null) => Response>): typeof fetch & { calls: [string, string | null][] } {
    const calls: [string, string | null][] = [];
    const f = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const auth = new Headers(init?.headers).get("authorization");
      calls.push([url, auth]);
      const r = routes[url];
      return r ? r(auth) : new Response("Not Found", { status: 404 });
    };
    return Object.assign(f, { calls }) as never;
  }
  const API_TAR = "https://api.github.com/repos/acme/secret/tarball/main";
  const PUBLIC_TAR = "https://codeload.github.com/acme/secret/tar.gz/main";
  const A = { scope: "org-a", token: "ghs_a" };
  const B = { scope: "org-b", token: "ghs_b" };

  it("reads a private repo from the API's tarball with the token, and never sends the token to codeload", async () => {
    const f = authFetch({ [API_TAR]: (auth) => (auth === "Bearer ghs_a" ? tarResponse(closetTarball("acme-secret-main"))() : new Response("", { status: 404 })) });
    const snap = await githubSnapshot("acme/secret", "main", { fetch: f, auth: A });
    expect(snap?.read("src/a.tsx")).toBe("export const A = 1;\n");
    expect(f.calls).toEqual([[API_TAR, "Bearer ghs_a"]]);
    expect(f.calls.some(([u, a]) => u.startsWith("https://codeload.github.com") && a)).toBe(false);
  });

  it("keeps each company's snapshot to itself: the public reader and another company each download their own", async () => {
    const f = authFetch({
      [API_TAR]: (auth) => (auth === "Bearer ghs_a" ? tarResponse(closetTarball("acme-secret-main"))() : new Response("", { status: 404 })),
      [PUBLIC_TAR]: () => new Response("", { status: 404 }), // private: codeload has nothing for an outsider
    });
    expect(await githubSnapshot("acme/secret", "main", { fetch: f, auth: A })).not.toBeNull();
    // The same repo@ref, asked publicly and by another company, is not served from company A's cache.
    expect(await githubSnapshot("acme/secret", "main", { fetch: f })).toBeNull();
    expect(await githubSnapshot("acme/secret", "main", { fetch: f, auth: B })).toBeNull();
    expect(f.calls.map(([u, a]) => `${u} ${a ?? "-"}`)).toEqual([`${API_TAR} Bearer ghs_a`, `${PUBLIC_TAR} -`, `${API_TAR} Bearer ghs_b`]);
    // Company A asking again is a cache hit.
    await githubSnapshot("acme/secret", "main", { fetch: f, auth: A });
    expect(f.calls).toHaveLength(3);
  });

  it("openRepo reads as the company, and falls back to the public tarball for a public repo its installation wasn't given", async () => {
    const f = authFetch({
      "https://api.github.com/repos/acme/secret": (auth) => (auth ? json({ default_branch: "main" })() : new Response("", { status: 404 })),
      [API_TAR]: (auth) => (auth ? tarResponse(closetTarball("acme-secret-main"))() : new Response("", { status: 404 })),
      "https://codeload.github.com/acme/open/tar.gz/main": tarResponse(closetTarball("acme-open-main")),
    });
    expect((await openRepo({ repo_full_name: "acme/secret", watched_branch: null }, { fetch: f, auth: A }))?.ref).toBe("main");
    expect(await openRepo({ repo_full_name: "acme/secret", watched_branch: null }, { fetch: f, auth: null })).toBeNull();
    expect(await openRepo({ repo_full_name: "acme/open", watched_branch: "main" }, { fetch: f, auth: A })).not.toBeNull();
    expect(f.calls.map(([u]) => u)).toContain("https://codeload.github.com/acme/open/tar.gz/main");
  });

  it("unreadableReason sees the repo the company was given as there (so it's the branch that's wrong)", async () => {
    const f = authFetch({ "https://api.github.com/repos/acme/secret": (auth) => (auth ? json({ default_branch: "main" })() : new Response("", { status: 404 })) });
    expect(await unreadableReason("acme/secret", { fetch: f, auth: A })).toBe("repo_missing");
    expect(await unreadableReason("acme/secret", { fetch: f, auth: null })).toBe("repo_private");
  });
});
