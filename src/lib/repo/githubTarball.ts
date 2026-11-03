// A GitHub repository's tarball: one streamed download, gunzipped with node:zlib and parsed by the small tar reader
// below (no dependency). A public repository is read from codeload with no credentials; with a company's GitHub App
// installation token (`auth`), from the API's tarball endpoint, which redirects to a short-lived codeload URL, so private
// repositories the installation was given read too. Only source files are kept, in memory. Parsed snapshots and API
// answers are cached per company (or "public") and repo@ref, never across companies: a private snapshot must not reach
// a company that only typed the repository's name. Private and missing repositories both answer 404 without a token;
// the API (unreadableReason in snapshot.ts) tells the two apart.
import { createGunzip, constants as zlibConstants } from "node:zlib";
import { once } from "node:events";
import type { RepoFile, RepoSnapshot } from "./snapshot";
import { isSourcePath, looksBinary, MAX_FILE_BYTES, MAX_FILES, MAX_SNAPSHOT_BYTES } from "./files";

/** The download stops after this many compressed bytes; what was read so far is kept (the snapshot is then partial). */
export const MAX_DOWNLOAD_BYTES = 80 * 1024 * 1024;
const CACHE_MS = 10 * 60 * 1000;
/** At most this many parsed snapshots stay in memory (each can hold up to MAX_SNAPSHOT_BYTES); the oldest goes first. */
const CACHE_MAX = 6;
const META_CACHE_MS = 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 45_000;
const API_TIMEOUT_MS = 10_000;

export type Fetch = typeof fetch;

export const GITHUB_UNREACHABLE = "PMA couldn't reach GitHub just now. Try again in a minute.";
export const GITHUB_RATE_LIMITED = "GitHub is limiting requests from PMA right now. Try again in a few minutes.";

/** GitHub could not be asked (network, timeout, rate limit, a 5xx). The message is a sentence for the person. */
export class RepoFetchError extends Error {
  constructor(message = GITHUB_UNREACHABLE, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RepoFetchError";
  }
}

// ---- the tar reader ---------------------------------------------------------------------------------------------------

const BLOCK = 512;
const MAX_META_BYTES = 1024 * 1024;

export type TarEntry = { path: string; size: number; body: Buffer };

/** A NUL-terminated string field of a header. */
function field(b: Buffer, start: number, end: number): string {
  const s = b.subarray(start, end);
  const nul = s.indexOf(0);
  return s.subarray(0, nul === -1 ? s.length : nul).toString("utf8");
}

/** The size field: octal text, or GNU base-256 when the high bit of its first byte is set. */
function sizeOf(h: Buffer): number {
  if (h[124] & 0x80) {
    let n = h[124] & 0x7f;
    for (let i = 125; i < 136; i++) n = n * 256 + h[i];
    return n;
  }
  const s = field(h, 124, 136).trim();
  return s ? parseInt(s, 8) : 0;
}

/** The header checksum: the sum of all bytes with the checksum field read as spaces. */
function checksumOk(h: Buffer): boolean {
  const stored = parseInt(field(h, 148, 156).trim(), 8);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
  return sum === stored;
}

/** The `path` record of a pax extended header ("<len> path=<value>\n"), or null. */
function paxPath(body: Buffer): string | null {
  let found: string | null = null;
  for (let pos = 0; pos < body.length;) {
    const sp = body.indexOf(0x20, pos);
    if (sp === -1) break;
    const len = parseInt(body.subarray(pos, sp).toString("ascii"), 10);
    if (!(len > 0) || pos + len > body.length) break;
    const rec = body.subarray(sp + 1, pos + len - 1).toString("utf8");
    const eq = rec.indexOf("=");
    if (eq > 0 && rec.slice(0, eq) === "path") found = rec.slice(eq + 1);
    pos += len;
  }
  return found;
}

/** Drops the first path segment (codeload puts everything under "<repo>-<ref>/"); "" for the top folder itself. */
function stripTop(p: string): string {
  const rest = p.slice(p.indexOf("/") + 1);
  return p.includes("/") && !rest.split("/").some((s) => s === ".." || s === ".") ? rest : "";
}

/**
 * Parses a tar stream pushed in chunks of any size. Regular files ("0" or NUL) that `keep` accepts reach `onEntry` with
 * their bytes, path without the top folder; GNU long names ("L") and pax "path" records ("x") name the next entry;
 * everything else (folders, links, global headers) is skipped without buffering. Stops at the end-of-archive block, or
 * when `stop()` is called.
 */
export class TarReader {
  private buf: Buffer = Buffer.alloc(0);
  private skip = 0;
  private pending: { kind: "file" | "L" | "x"; path: string; size: number; padded: number } | null = null;
  private longName: string | null = null;
  private paxName: string | null = null;
  done = false;

  constructor(private keep: (path: string, size: number) => boolean, private onEntry: (e: TarEntry) => void) {}

  stop(): void { this.done = true; }

  push(chunk: Buffer): void {
    if (this.done) return;
    if (this.skip) {
      const n = Math.min(this.skip, chunk.length);
      this.skip -= n;
      chunk = chunk.subarray(n);
      if (!chunk.length) return;
    }
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (!this.done) {
      if (this.pending) {
        const p = this.pending;
        if (this.buf.length < p.size) return;
        const body = Buffer.from(this.buf.subarray(0, p.size)); // a copy, so the big chunk it came from can be freed
        this.consume(p.padded);
        this.pending = null;
        if (p.kind === "L") this.longName = field(body, 0, body.length);
        else if (p.kind === "x") this.paxName = paxPath(body) ?? this.paxName;
        else this.onEntry({ path: p.path, size: p.size, body });
        continue;
      }
      if (this.buf.length < BLOCK) return;
      const h = this.buf.subarray(0, BLOCK);
      if (h.every((b) => b === 0)) { this.done = true; return; }
      if (!checksumOk(h)) throw new Error("not a tar archive (bad header checksum)");
      this.consume(BLOCK);
      const size = sizeOf(h);
      const padded = Math.ceil(size / BLOCK) * BLOCK;
      const type = String.fromCharCode(h[156]);
      if (type === "L" || type === "x") {
        if (size > MAX_META_BYTES) throw new Error("tar metadata header too large");
        this.pending = { kind: type, path: "", size, padded };
        continue;
      }
      if (type === "g") { this.consume(padded); continue; } // a global pax header (git archive's commit id)
      const ustar = field(h, 257, 263).startsWith("ustar");
      const name = this.paxName ?? this.longName ?? (ustar && field(h, 345, 500) ? `${field(h, 345, 500)}/${field(h, 0, 100)}` : field(h, 0, 100));
      this.paxName = this.longName = null;
      const path = type === "0" || type === "\0" ? stripTop(name) : "";
      if (path && this.keep(path, size)) this.pending = { kind: "file", path, size, padded };
      else this.consume(padded);
    }
  }

  /** Drops n bytes, remembering how many are still to come when the buffer holds fewer. */
  private consume(n: number): void {
    if (this.buf.length >= n) { this.buf = this.buf.subarray(n); return; }
    this.skip += n - this.buf.length;
    this.buf = Buffer.alloc(0);
  }
}

// ---- the download -----------------------------------------------------------------------------------------------------

/**
 * Streams a gzipped tar body through the reader, with backpressure. Returns true when the download was cut short (the
 * byte cap, or a timeout once something was read); throws for a body that is not a gzipped tar or that failed before
 * anything was read. A cut-short stream is ended gracefully (Z_SYNC_FLUSH), so whatever was already inflated is kept.
 */
async function streamTarGz(body: ReadableStream<Uint8Array>, tar: TarReader, maxBytes: number, haveFiles: () => boolean): Promise<boolean> {
  const gunzip = createGunzip({ finishFlush: zlibConstants.Z_SYNC_FLUSH });
  const finished = new Promise<void>((resolve, reject) => {
    gunzip.on("data", (chunk: Buffer) => {
      try { tar.push(chunk); } catch (e) { reject(e); gunzip.destroy(); return; }
      if (tar.done) resolve();
    });
    gunzip.on("end", resolve);
    gunzip.on("error", reject);
  });
  finished.catch(() => {}); // awaited below; this only keeps an early rejection from being reported as unhandled
  const reader = body.getReader();
  let received = 0;
  let cut = false;
  try {
    while (!tar.done) {
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await reader.read();
      } catch (e) {
        const name = e instanceof Error ? e.name : "";
        if ((name === "TimeoutError" || name === "AbortError") && haveFiles()) { cut = true; break; }
        throw e;
      }
      if (next.done) break;
      received += next.value.length;
      if (received > maxBytes) { cut = true; break; }
      if (!gunzip.write(next.value)) await Promise.race([once(gunzip, "drain"), finished]);
    }
  } catch (e) {
    gunzip.destroy();
    throw e;
  } finally {
    reader.cancel().catch(() => {});
  }
  if (tar.done) gunzip.destroy();
  else gunzip.end();
  await finished;
  return cut;
}

/** Each path segment encoded on its own, so a branch like feature/x keeps its slash. */
const encodePath = (s: string) => s.split("/").map(encodeURIComponent).join("/");

/** A company's installation token, and the company it belongs to (the cache scope). */
export type GithubAuth = { scope: string; token: string };

/** GitHub's REST API; GITHUB_API_URL points the e2e suite at a fake. */
const apiUrl = () => (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/+$/, "");
const API_HEADERS = { accept: "application/vnd.github+json", "user-agent": "PMA", "x-github-api-version": "2022-11-28" } as const;
const scopeOf = (auth: GithubAuth | null | undefined) => (auth ? `org:${auth.scope}` : "public");

export type GithubOptions = {
  fetch?: Fetch;
  /** Read as this company's GitHub installation; without it, only public repositories read. */
  auth?: GithubAuth | null;
  /** Compressed bytes to download at most. */
  maxBytes?: number;
  /** Files to keep at most. */
  maxFiles?: number;
  /** Source bytes to keep in memory at most. */
  maxSourceBytes?: number;
};

async function download(repo: string, ref: string, opts: GithubOptions): Promise<RepoSnapshot | null> {
  const f = opts.fetch ?? globalThis.fetch;
  const url = opts.auth
    ? `${apiUrl()}/repos/${encodePath(repo)}/tarball/${encodePath(ref)}`
    : `https://codeload.github.com/${encodePath(repo)}/tar.gz/${encodePath(ref)}`;
  // The token goes only to the API; fetch drops it on the cross-origin redirect to codeload, whose URL carries its own.
  const headers = opts.auth ? { ...API_HEADERS, authorization: `Bearer ${opts.auth.token}` } : undefined;
  let res: Response;
  try {
    res = await f(url, { redirect: "follow", headers, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (e) {
    throw new RepoFetchError(GITHUB_UNREACHABLE, { cause: e });
  }
  if (!res.ok || !res.body) {
    await res.body?.cancel().catch(() => {});
    if (res.status === 403 || res.status === 429) throw new RepoFetchError(GITHUB_RATE_LIMITED);
    // 404 for a private or missing repo or ref (codeload doesn't say which); any other 4xx means the same here.
    if (res.status >= 400 && res.status < 500) return null;
    throw new RepoFetchError(GITHUB_UNREACHABLE);
  }

  const maxFiles = opts.maxFiles ?? MAX_FILES;
  const maxSourceBytes = opts.maxSourceBytes ?? MAX_SNAPSHOT_BYTES;
  const bodies = new Map<string, Buffer>();
  let kept = 0;
  let truncated = false;
  const tar = new TarReader(
    (p, size) => size <= MAX_FILE_BYTES && isSourcePath(p),
    (e) => {
      if (looksBinary(e.body)) return;
      if (kept + e.size > maxSourceBytes) { truncated = true; tar.stop(); return; }
      bodies.set(e.path, e.body);
      kept += e.size;
      if (bodies.size >= maxFiles) { truncated = true; tar.stop(); }
    },
  );
  try {
    if (await streamTarGz(res.body, tar, opts.maxBytes ?? MAX_DOWNLOAD_BYTES, () => bodies.size > 0)) truncated = true;
  } catch (e) {
    throw new RepoFetchError(GITHUB_UNREACHABLE, { cause: e });
  }

  const files: RepoFile[] = [...bodies].map(([path, b]) => ({ path, size: b.length })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    repo, ref, source: "github", truncated,
    files: () => files.slice(),
    read: (p: string) => bodies.get(p)?.toString("utf8") ?? null,
  };
}

// ---- caches -------------------------------------------------------------------------------------------------------

const snapshots = new Map<string, { at: number; snap: Promise<RepoSnapshot | null> }>();
const metas = new Map<string, { at: number; meta: Promise<RepoMeta> }>();

/** Forgets every cached snapshot and API answer (tests). */
export function clearGithubCache(): void {
  snapshots.clear();
  metas.clear();
}

function prune<T extends { at: number }>(m: Map<string, T>, ttl: number, now: number) {
  for (const [k, v] of m) if (now - v.at >= ttl) m.delete(k);
}

/**
 * The repository's source files at `ref`, or null when GitHub has no such repo or ref this reader may see. Throws
 * RepoFetchError when GitHub can't be asked. Parsed once per company (or public) and repo@ref, and kept for 10 minutes
 * (the 6 newest); a concurrent caller with the same scope shares the download in flight. Failures and nulls are not
 * cached.
 */
export function githubSnapshot(repo: string, ref: string, opts: GithubOptions = {}): Promise<RepoSnapshot | null> {
  const now = Date.now();
  prune(snapshots, CACHE_MS, now);
  const key = `${scopeOf(opts.auth)}:${repo.toLowerCase()}@${ref}`;
  const hit = snapshots.get(key);
  if (hit) return hit.snap;
  const snap = download(repo, ref, opts);
  const entry = { at: now, snap };
  snapshots.set(key, entry);
  while (snapshots.size > CACHE_MAX) snapshots.delete(snapshots.keys().next().value!);
  const forget = () => { if (snapshots.get(key) === entry) snapshots.delete(key); };
  snap.then((s) => { if (!s) forget(); }, forget);
  return snap;
}

export type RepoMeta = { exists: true; defaultBranch: string } | { exists: false };

/**
 * What the API says about the repo: exists (with its default branch) or not. Unauthenticated, "not" covers private
 * repositories too; with a company's installation token, it covers the ones the installation wasn't given. Throws
 * RepoFetchError on network errors, rate limits and 5xx. Kept for a minute, per company or public.
 */
export function githubRepoMeta(repo: string, opts: { fetch?: Fetch; auth?: GithubAuth | null } = {}): Promise<RepoMeta> {
  const now = Date.now();
  prune(metas, META_CACHE_MS, now);
  const key = `${scopeOf(opts.auth)}:${repo.toLowerCase()}`;
  const hit = metas.get(key);
  if (hit) return hit.meta;
  const meta = (async (): Promise<RepoMeta> => {
    const f = opts.fetch ?? globalThis.fetch;
    let res: Response;
    try {
      res = await f(`${apiUrl()}/repos/${encodePath(repo)}`, {
        headers: opts.auth ? { ...API_HEADERS, authorization: `Bearer ${opts.auth.token}` } : API_HEADERS,
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
    } catch (e) {
      throw new RepoFetchError(GITHUB_UNREACHABLE, { cause: e });
    }
    if (res.status === 404) return { exists: false };
    if (res.status === 403 || res.status === 429) throw new RepoFetchError(GITHUB_RATE_LIMITED);
    if (!res.ok) throw new RepoFetchError(GITHUB_UNREACHABLE);
    const j = (await res.json().catch(() => null)) as { default_branch?: unknown } | null;
    return { exists: true, defaultBranch: typeof j?.default_branch === "string" && j.default_branch ? j.default_branch : "main" };
  })();
  const entry = { at: now, meta };
  metas.set(key, entry);
  meta.catch(() => { if (metas.get(key) === entry) metas.delete(key); });
  return meta;
}
