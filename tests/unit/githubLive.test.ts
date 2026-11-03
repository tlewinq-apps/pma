// See it live: a pull request's preview site (GitHub deployments of its head commit, production ones left out) and its
// checks (check runs and commit statuses), read as the company's installation; what happens without the read
// permissions (a fresh token once, then "needs permission"); the 15-second cache; the issue route (outsiders get a 404,
// only open pull requests are read); and the panel beside the mock-up. GitHub and the database are faked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const h = vi.hoisted(() => ({
  conn: null as null | { id: string; external_id: string | null; status: string; display: Record<string, unknown> },
  ctx: null as null | { org: { id: string }; project: { kind: string; repo_full_name: string | null } },
  links: [] as { issue_id: string; repo: string; number: number; url: string; state: string; created_at: string }[],
  liveFor: null as null | ((orgId: string, prs: unknown[]) => Promise<unknown>),
}));

vi.mock("@/lib/db/server", () => ({
  serviceDb: () => ({}),
  // pull_request_links under RLS: eq filters, newest first, a limit.
  userDb: async () => ({
    from: () => {
      const f: [string, unknown][] = [];
      let n = Infinity;
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => { f.push([c, v]); return q; },
        order: () => q,
        limit: (k: number) => { n = k; return q; },
        then: (ok: (v: unknown) => void) => ok({ data: h.links.filter((l) => f.every(([c, v]) => (l as Record<string, unknown>)[c] === v)).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, n), error: null }),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/connections/store", () => ({ findConnection: async () => h.conn, markConnection: async () => {} }));
vi.mock("@/lib/db/app", () => ({ appForIssue: async () => h.ctx }));

import { forgetGithubTokens, installationGrantFor } from "@/lib/github/app";
import { forgetLive, installationSettingsUrl, isProduction, liveFor, providerName, readLive, summarizeChecks, type LiveView } from "@/lib/github/live";
import { checksLine, LivePanel, liveSettled, livePreviewOf } from "@/components/workspace/LivePreview";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const T = "2026-10-17T12:00:00Z";
const ALL = { deployments: "read", checks: "read", statuses: "read", contents: "write", pull_requests: "write" };

/** GitHub's API as a table of answers by path (with its query); anything else is a 404. Every call is recorded. */
function github(answers: Record<string, unknown | [number, unknown]>) {
  const calls: string[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input));
    const path = `${u.pathname}${u.search}`;
    calls.push(`${init?.method ?? "GET"} ${path}`);
    const a = answers[path];
    const [status, body] = a === undefined ? [404, { message: "Not Found" }] : Array.isArray(a) && typeof a[0] === "number" ? (a as [number, unknown]) : [200, a];
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
}

const PR = { "/repos/acme/web/pulls/7": { head: { sha: "abc123", ref: "pma/aa11bb-build-1" } } };
const vercelPreview = { id: 11, sha: "abc123", ref: "abc123", environment: "Preview", created_at: "2026-10-17T11:58:00Z", creator: { login: "vercel[bot]" } };
const production = { id: 10, sha: "abc123", ref: "abc123", environment: "Production – web", created_at: "2026-10-17T11:59:00Z", production_environment: true, creator: { login: "vercel[bot]" } };
const ready = [{ state: "success", environment_url: "https://web-abc.vercel.app", target_url: "https://web-abc.vercel.app", log_url: "https://vercel.com/acme/web/dpl", created_at: "2026-10-17T11:59:30Z" }];
const checks = {
  "/repos/acme/web/commits/abc123/check-runs?per_page=100": { check_runs: [
    { name: "build", status: "completed", conclusion: "success" },
    { name: "lint", status: "completed", conclusion: "failure" },
    { name: "e2e", status: "in_progress", conclusion: null },
  ] },
  "/repos/acme/web/commits/abc123/status": { statuses: [{ context: "Vercel", state: "success" }] },
};
const pr7 = { repo: "acme/web", number: 7, url: "https://github.com/acme/web/pull/7" };

beforeEach(() => {
  vi.stubEnv("GITHUB_APP_ID", "12345");
  vi.stubEnv("GITHUB_APP_SLUG", "pma-test");
  vi.stubEnv("GITHUB_APP_CLIENT_ID", "Iv1.client");
  vi.stubEnv("GITHUB_APP_CLIENT_SECRET", "secret");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", PEM);
  h.conn = { id: "c1", external_id: "77", status: "ok", display: { account: "acme", account_type: "Organization" } };
  h.ctx = { org: { id: "org-1" }, project: { kind: "customer", repo_full_name: "acme/web" } };
  h.links = []; h.liveFor = null;
  forgetGithubTokens(); forgetLive();
});
afterEach(() => vi.unstubAllEnvs());

describe("reading a pull request's preview and checks", () => {
  it("finds the preview of the head commit (not production), names its host, and sums the checks", async () => {
    const { f, calls } = github({ ...PR, ...checks,
      "/repos/acme/web/deployments?sha=abc123&per_page=20": [production, vercelPreview],
      "/repos/acme/web/deployments/11/statuses?per_page=5": ready,
    });
    const v = await readLive({ prs: [pr7], token: "ghs_x", permissions: ALL, manageUrl: "https://github.com/x", fetch: f });
    expect(v).toEqual({
      needs: null, noPreviews: false, manageUrl: null,
      prs: [{ number: 7, url: pr7.url,
        preview: { state: "ready", url: "https://web-abc.vercel.app", logUrl: "https://vercel.com/acme/web/dpl", provider: "Vercel", updatedAt: "2026-10-17T11:59:30Z" },
        checks: { state: "failing", total: 4, passed: 2, failed: 1, running: 1, failing: ["lint"], url: "https://github.com/acme/web/pull/7/checks" } }],
    });
    expect(calls).not.toContain("GET /repos/acme/web/deployments/10/statuses?per_page=5");
  });

  it("falls back to the branch for hosts that record it, and says when the preview is still building or failed", async () => {
    const netlify = { ...vercelPreview, id: 21, ref: "pma/aa11bb-build-1", environment: "deploy-preview", creator: { login: "netlify[bot]" } };
    const building = github({ ...PR, ...checks,
      "/repos/acme/web/deployments?sha=abc123&per_page=20": [],
      "/repos/acme/web/deployments?ref=pma%2Faa11bb-build-1&per_page=20": [netlify],
      "/repos/acme/web/deployments/21/statuses?per_page=5": [{ state: "in_progress", log_url: "https://app.netlify.com/log", created_at: T }],
    });
    const b = await readLive({ prs: [pr7], token: "t", permissions: ALL, manageUrl: null, fetch: building.f });
    expect(b.prs[0].preview).toEqual({ state: "building", url: null, logUrl: "https://app.netlify.com/log", provider: "Netlify", updatedAt: T });

    const failed = github({ ...PR, ...checks,
      "/repos/acme/web/deployments?sha=abc123&per_page=20": [vercelPreview],
      "/repos/acme/web/deployments/11/statuses?per_page=5": [{ state: "failure", target_url: "https://vercel.com/acme/web/dpl", created_at: T }],
    });
    expect((await readLive({ prs: [pr7], token: "t", permissions: ALL, manageUrl: null, fetch: failed.f })).prs[0].preview)
      .toMatchObject({ state: "failed", url: null, logUrl: "https://vercel.com/acme/web/dpl" });
  });

  it("tells a repository that never publishes previews from one whose preview hasn't started", async () => {
    const base = { ...PR, ...checks, "/repos/acme/web/deployments?sha=abc123&per_page=20": [], "/repos/acme/web/deployments?ref=pma%2Faa11bb-build-1&per_page=20": [] };
    const never = github({ ...base, "/repos/acme/web/deployments?per_page=30": [production] });
    expect(await readLive({ prs: [pr7], token: "t", permissions: ALL, manageUrl: null, fetch: never.f })).toMatchObject({ noPreviews: true, prs: [{ preview: null }] });
    const notYet = github({ ...base, "/repos/acme/web/deployments?per_page=30": [production, { ...vercelPreview, sha: "old" }] });
    expect(await readLive({ prs: [pr7], token: "t", permissions: ALL, manageUrl: null, fetch: notYet.f })).toMatchObject({ noPreviews: false, prs: [{ preview: null }] });
  });

  it("without the read permissions asks GitHub for nothing it can't read, and points at the installation's settings", async () => {
    const { f, calls } = github({ ...PR });
    const v = await readLive({ prs: [pr7], token: "t", permissions: { contents: "write", pull_requests: "write" }, manageUrl: "https://github.com/organizations/acme/settings/installations/77", fetch: f });
    expect(v).toEqual({ prs: [{ number: 7, url: pr7.url, preview: null, checks: null }], needs: "permission", noPreviews: false, manageUrl: "https://github.com/organizations/acme/settings/installations/77" });
    expect(calls).toEqual(["GET /repos/acme/web/pulls/7"]);
  });

  it("takes GitHub's 403 as a permission not granted, and skips a pull request it can no longer see", async () => {
    const { f } = github({ ...PR, ...checks, "/repos/acme/web/deployments?sha=abc123&per_page=20": [403, { message: "Resource not accessible by integration" }] });
    const v = await readLive({ prs: [pr7, { ...pr7, number: 8 }], token: "t", permissions: ALL, manageUrl: "m", fetch: f });
    expect(v.needs).toBe("permission");
    expect(v.prs.map((p) => p.number)).toEqual([7]);
    expect(v.prs[0].checks?.state).toBe("failing");
  });

  it("sums checks: errors fail, pending runs, neutral and skipped pass, nothing is none", () => {
    expect(summarizeChecks([{ name: "a", status: "completed", conclusion: "skipped" }, { name: "b", status: "completed", conclusion: "neutral" }], [{ context: "ci", state: "error" }], "u"))
      .toEqual({ state: "failing", total: 3, passed: 2, failed: 1, running: 0, failing: ["ci"], url: "u" });
    expect(summarizeChecks([], [{ context: "ci", state: "pending" }], "u").state).toBe("running");
    expect(summarizeChecks([{ name: "a", status: "completed", conclusion: "success" }], null, "u").state).toBe("passing");
    expect(summarizeChecks(null, null, "u").state).toBe("none");
  });

  it("knows production by its flag or its name, and hosts by their bot", () => {
    expect(isProduction({ environment: "Production – closet" })).toBe(true);
    expect(isProduction({ environment: "github-pages" })).toBe(true);
    expect(isProduction({ environment: "Preview", production_environment: false })).toBe(false);
    expect(isProduction({ environment: "staging", production_environment: true })).toBe(true);
    expect(providerName("vercel[bot]")).toBe("Vercel");
    expect(providerName("cloudflare-workers-and-pages[bot]")).toBe("Cloudflare Pages");
    expect(providerName("acme-deployer[bot]")).toBe("Acme Deployer");
    expect(providerName(undefined)).toBeNull();
  });

  it("sends an organization to its own installation settings, a person to theirs", () => {
    expect(installationSettingsUrl("77", "acme", "Organization")).toBe("https://github.com/organizations/acme/settings/installations/77");
    expect(installationSettingsUrl("77", "thomas", "User")).toBe("https://github.com/settings/installations/77");
  });
});

describe("a token that carries new permissions", () => {
  it("is minted again when the cached one lacks them, at most every two minutes", async () => {
    let n = 0;
    const perms = [{ contents: "write" }, ALL];
    const f = (async () => new Response(JSON.stringify({ token: `ghs_${++n}`, expires_at: "2026-10-17T13:00:00Z", permissions: perms[Math.min(n - 1, 1)] }), { status: 201 })) as typeof fetch;
    let now = Date.parse(T);
    const clock = () => now;
    expect((await installationGrantFor("77", ["deployments"], f, clock)).token).toBe("ghs_2"); // the first lacked it: minted again
    expect((await installationGrantFor("77", ["deployments"], f, clock)).token).toBe("ghs_2"); // has it now: reused
    expect(n).toBe(2);

    forgetGithubTokens();
    n = 0; perms[1] = { contents: "write" }; // never accepted
    await installationGrantFor("77", ["deployments"], f, clock);
    await installationGrantFor("77", ["deployments"], f, clock);
    expect(n).toBe(2); // once on the first read, not again within two minutes
    now += 2 * 60_000 + 1;
    await installationGrantFor("77", ["deployments"], f, clock);
    expect(n).toBe(3);
  });
});

describe("liveFor", () => {
  it("says GitHub isn't connected, and keeps a read for 15 seconds", async () => {
    h.conn = null;
    expect((await liveFor("org-1", [pr7])).needs).toBe("github");
    h.conn = { id: "c1", external_id: "77", status: "ok", display: { account: "acme", account_type: "Organization" } };
    const { f, calls } = github({ ...PR, ...checks,
      "/app/installations/77/access_tokens": { token: "ghs_1", expires_at: "2026-10-17T13:00:00Z", permissions: ALL },
      "/repos/acme/web/deployments?sha=abc123&per_page=20": [vercelPreview],
      "/repos/acme/web/deployments/11/statuses?per_page=5": ready,
    });
    let now = Date.parse(T);
    const first = await liveFor("org-1", [pr7], { fetch: f, now: () => now });
    expect(first.prs[0].preview?.url).toBe("https://web-abc.vercel.app");
    const asked = calls.length;
    now += 10_000;
    expect(await liveFor("org-1", [pr7], { fetch: f, now: () => now })).toBe(first);
    expect(calls.length).toBe(asked);
    now += 6_000;
    await liveFor("org-1", [pr7], { fetch: f, now: () => now });
    expect(calls.length).toBeGreaterThan(asked);
  });
});

describe("GET /api/issues/[id]/live", () => {
  const call = async (id = "11111111-1111-4111-8111-111111111111") => {
    vi.doMock("@/lib/github/live", async (orig) => ({ ...(await orig<typeof import("@/lib/github/live")>()), liveFor: (o: string, p: unknown[]) => h.liveFor!(o, p) }));
    vi.resetModules();
    const { GET } = await import("@/app/api/issues/[id]/live/route");
    const res = await GET(new Request(`https://pma.example/api/issues/${id}/live`), { params: Promise.resolve({ id }) });
    vi.doUnmock("@/lib/github/live");
    return res;
  };
  const issue = "11111111-1111-4111-8111-111111111111";

  it("is a 404 to people outside the company, and empty for the demo app", async () => {
    h.liveFor = vi.fn(async () => ({}));
    h.ctx = null;
    expect((await call()).status).toBe(404);
    h.ctx = { org: { id: "org-1" }, project: { kind: "demo", repo_full_name: "acme/web" } };
    expect(await (await call()).json()).toEqual({ prs: [], needs: null, noPreviews: false, manageUrl: null });
    expect(h.liveFor).not.toHaveBeenCalled();
  });

  it("reads only the issue's open pull requests, newest first, and says when GitHub didn't answer", async () => {
    h.links = [
      { issue_id: issue, repo: "acme/web", number: 7, url: pr7.url, state: "open", created_at: "2026-10-17T11:00:00Z" },
      { issue_id: issue, repo: "acme/web", number: 9, url: "https://github.com/acme/web/pull/9", state: "open", created_at: "2026-10-17T11:30:00Z" },
      { issue_id: issue, repo: "acme/web", number: 5, url: "u5", state: "closed", created_at: "2026-10-17T10:00:00Z" },
      { issue_id: "other", repo: "acme/web", number: 6, url: "u6", state: "open", created_at: "2026-10-17T10:00:00Z" },
    ];
    h.liveFor = vi.fn(async () => ({ prs: [], needs: null, noPreviews: false, manageUrl: null }));
    const res = await call(issue);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.liveFor).toHaveBeenCalledWith("org-1", [{ repo: "acme/web", number: 9, url: "https://github.com/acme/web/pull/9" }, { repo: "acme/web", number: 7, url: pr7.url }]);
    h.liveFor = async () => { throw new Error("GitHub 502"); };
    const bad = await call(issue);
    expect(bad.status).toBe(502);
    expect((await bad.json()).error).toMatch(/GitHub didn't answer/);
  });
});

describe("the panel beside the mock-up", () => {
  const view = (o: Partial<LiveView> & { pr?: Partial<LiveView["prs"][number]> } = {}): LiveView => ({
    needs: null, noPreviews: false, manageUrl: null, ...o,
    prs: o.prs ?? [{ number: 7, url: pr7.url, preview: { state: "ready", url: "https://web-abc.vercel.app", logUrl: null, provider: "Vercel", updatedAt: "2026-10-17T11:57:00Z" }, checks: { state: "passing", total: 3, passed: 3, failed: 0, running: 0, failing: [], url: "https://github.com/acme/web/pull/7/checks" }, ...o.pr }],
  });
  const html = (v: LiveView | null, error: string | null = null) => renderToStaticMarkup(createElement(LivePanel, { view: v, error, at: Date.parse(T) }));

  it("opens the preview from See it live, with its host and age, and the checks beside it", () => {
    const out = html(view());
    expect(out).toContain('href="https://web-abc.vercel.app"');
    expect(out).toContain("See it live");
    expect(out).toContain("The preview of pull request #7 on Vercel, updated 3 min ago");
    expect(out).toContain("All 3 checks passed");
    expect(out).toContain('href="https://github.com/acme/web/pull/7/checks"');
  });

  it("says what's missing: a preview building, none published, the permissions to accept", () => {
    expect(html(view({ pr: { preview: { state: "building", url: null, logUrl: "https://vercel.com/log", provider: "Vercel", updatedAt: T } } }))).toContain("Building the preview of pull request #7 on Vercel");
    expect(html(view({ noPreviews: true, pr: { preview: null } }))).toContain("doesn&#x27;t publish preview sites");
    expect(html(view({ pr: { preview: null } }))).toContain("Waiting for the preview of pull request #7");
    const perm = html(view({ needs: "permission", manageUrl: "https://github.com/settings/installations/77", pr: { preview: null, checks: null } }));
    expect(perm).toContain("accept PMA&#x27;s new GitHub permissions");
    expect(perm).toContain('href="https://github.com/settings/installations/77"');
    expect(perm).not.toContain("Waiting for the preview");
    expect(html(view({ needs: "github", prs: [] }))).toBe("");
  });

  it("knows when nothing is on its way, so the page stops asking", () => {
    expect(liveSettled(view())).toBe(true);
    expect(liveSettled(view({ pr: { preview: null } }))).toBe(false);
    expect(liveSettled(view({ noPreviews: true, pr: { preview: null } }))).toBe(true);
    expect(liveSettled(view({ pr: { checks: { state: "running", total: 2, passed: 1, failed: 0, running: 1, failing: [], url: "u" } } }))).toBe(false);
    expect(livePreviewOf(view(), 7)).toBe("https://web-abc.vercel.app");
    expect(livePreviewOf(view(), 8)).toBeNull();
    expect(checksLine({ state: "failing", total: 4, passed: 2, failed: 2, running: 0, failing: ["lint", "e2e"], url: "u" })).toBe("2 of 4 checks failed: lint, e2e");
    expect(checksLine({ state: "running", total: 4, passed: 2, failed: 0, running: 2, failing: [], url: "u" })).toBe("Checks running: 2 of 4 done");
  });
});
