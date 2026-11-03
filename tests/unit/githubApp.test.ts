// The PMA GitHub App: its own JWT, installation tokens kept until shortly before they lapse, the check that an
// installation GitHub named in a URL really is the signed-in person's, the setup and callback hand-offs, the App's
// webhook, and the manifest it's registered from. GitHub and the database are faked; nothing is called.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, createPublicKey, createVerify, generateKeyPairSync } from "node:crypto";

const h = vi.hoisted(() => ({
  saved: [] as { status: string; externalId?: string | null }[],
  marked: [] as [string, string][],
  audits: [] as { action: string }[],
  holder: null as null | { org_id: string },
  failOkSave: null as null | Error,
}));

vi.mock("@/lib/db/server", () => ({ serviceDb: () => { throw new Error("pass a db"); } }));
vi.mock("@/lib/connections/store", () => ({
  findConnection: async () => null,
  saveConnection: async (_k: string, _s: unknown, f: { status: string; externalId?: string | null }) => {
    if (f.status === "ok" && h.failOkSave) throw h.failOkSave;
    h.saved.push({ status: f.status, externalId: f.externalId });
    return { id: "conn-1" };
  },
  markConnection: async (id: string, status: string) => { h.marked.push([id, status]); },
  audit: async (e: { action: string }) => { h.audits.push(e); },
}));

import { appJwt, forgetGithubTokens, installationToken } from "@/lib/github/app";
import { saveGithubInstallation, githubAuthorizeUrl, githubInstallUrl } from "@/lib/github/install";
import { githubAppManifest } from "@/lib/github/manifest";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

beforeEach(() => {
  vi.stubEnv("GITHUB_APP_ID", "12345");
  vi.stubEnv("GITHUB_APP_SLUG", "pma-test");
  vi.stubEnv("GITHUB_APP_CLIENT_ID", "Iv1.client");
  vi.stubEnv("GITHUB_APP_CLIENT_SECRET", "secret");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", PEM.replace(/\n/g, "\\n")); // as the registration script writes it
  vi.stubEnv("APP_URL", "https://pma.example");
  h.saved = []; h.marked = []; h.audits = []; h.holder = null; h.failOkSave = null;
  forgetGithubTokens();
});
afterEach(() => vi.unstubAllEnvs());

describe("the app's JWT", () => {
  it("is RS256 over iat a minute back and a ten-minute life, issued by the app, and verifies with its public key", () => {
    const now = Date.UTC(2026, 9, 17, 12, 0, 0);
    const jwt = appJwt(now);
    const [head, body, sig] = jwt.split(".");
    expect(JSON.parse(Buffer.from(head, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(body, "base64url").toString());
    expect(claims).toEqual({ iat: now / 1000 - 60, exp: now / 1000 - 60 + 600, iss: "12345" });
    expect(createVerify("RSA-SHA256").update(`${head}.${body}`).verify(createPublicKey(publicKey.export({ type: "spki", format: "pem" })), Buffer.from(sig, "base64url"))).toBe(true);
  });
});

describe("installation tokens", () => {
  it("are minted with the JWT and reused until five minutes before they lapse", async () => {
    let t = Date.UTC(2026, 9, 17, 12, 0, 0);
    const calls: { url: string; auth: string | null }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify({ token: `ghs_${calls.length}`, expires_at: new Date(t + 60 * 60_000).toISOString() }), { status: 201 });
    }) as unknown as typeof fetch;
    expect(await installationToken("77", f, () => t)).toBe("ghs_1");
    expect(calls[0].url).toBe("https://api.github.com/app/installations/77/access_tokens");
    expect(calls[0].auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    t += 50 * 60_000; // 10 minutes left: still reused
    expect(await installationToken("77", f, () => t)).toBe("ghs_1");
    t += 6 * 60_000; // 4 minutes left: minted again
    expect(await installationToken("77", f, () => t)).toBe("ghs_2");
    expect(calls).toHaveLength(2);
  });
});

describe("saving an installation", () => {
  const userInstalls = (ids: number[]) => (async () => new Response(JSON.stringify({ total_count: ids.length, installations: ids.map((id) => ({ id, account: { login: "acme", type: "Organization" }, repository_selection: "selected" })) }), { status: 200 })) as unknown as typeof fetch;
  /** The holder lookup: connections.select().eq().eq().eq().maybeSingle(). */
  const db = () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: h.holder }) }; return { from: () => q } as never; };
  const s = { orgId: "org-a", projectId: "app-a", userId: "u1" };

  it("refuses an installation id the signed-in person's GitHub doesn't list (a forged setup URL)", async () => {
    expect(await saveGithubInstallation("999", "ghu_x", s, db(), userInstalls([77]))).toEqual({ ok: false, reason: "not_yours" });
    expect(await saveGithubInstallation("77; drop", "ghu_x", s, db(), userInstalls([77]))).toEqual({ ok: false, reason: "not_yours" });
    expect(h.saved).toEqual([]);
  });

  it("refuses an installation another company holds", async () => {
    h.holder = { org_id: "org-b" };
    expect(await saveGithubInstallation("77", "ghu_x", s, db(), userInstalls([77]))).toEqual({ ok: false, reason: "taken" });
    expect(h.saved).toEqual([]);
  });

  it("saves it pending, then ok, and audits it", async () => {
    expect(await saveGithubInstallation("77", "ghu_x", s, db(), userInstalls([12, 77]))).toEqual({ ok: true, account: "acme" });
    expect(h.saved).toEqual([{ status: "pending", externalId: "77" }, { status: "ok", externalId: "77" }]);
    expect(h.audits.map((a) => a.action)).toEqual(["connection.connected"]);
  });

  it("turns a race lost to another company (the unique index) into taken", async () => {
    h.failOkSave = new Error('connection update failed: duplicate key value violates unique constraint "connections_github_installation"');
    expect(await saveGithubInstallation("77", "ghu_x", s, db(), userInstalls([77]))).toEqual({ ok: false, reason: "taken" });
    expect(h.marked).toEqual([["conn-1", "disconnected"]]);
  });
});

describe("the hand-off URLs and the manifest", () => {
  it("installs on the app's page with the state, and signs in with PKCE back to the callback", () => {
    expect(githubInstallUrl("st")).toBe("https://github.com/apps/pma-test/installations/new?state=st");
    const u = new URL(githubAuthorizeUrl("st2", "chal"));
    expect(`${u.origin}${u.pathname}`).toBe("https://github.com/login/oauth/authorize");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ client_id: "Iv1.client", redirect_uri: "https://pma.example/api/github/callback", state: "st2", code_challenge: "chal", code_challenge_method: "S256" });
  });

  it("asks to write contents and pull requests (Build it) and read deployments, checks and statuses (See it live), hears pull requests, points setup and callback here, and has a webhook only in production", () => {
    const prod = githubAppManifest({ appUrl: "https://pma.example/", name: "PMA", redirectUrl: "http://localhost:4791/done", webhook: true });
    expect(prod.default_permissions).toEqual({ contents: "write", pull_requests: "write", deployments: "read", checks: "read", statuses: "read", metadata: "read" });
    expect(prod.default_events).toEqual(["pull_request"]);
    expect(prod.setup_url).toBe("https://pma.example/api/github/setup");
    expect(prod.callback_urls).toEqual(["https://pma.example/api/github/callback"]);
    expect(prod.hook_attributes).toEqual({ url: "https://pma.example/api/github/webhook/app", active: true });
    expect(prod.request_oauth_on_install).toBe(false);
    expect(githubAppManifest({ appUrl: "http://localhost:3000", name: "PMA Dev", redirectUrl: "x", webhook: false }).hook_attributes).toBeUndefined();
  });
});

describe("the App's webhook", () => {
  it("refuses a bad signature and revokes the company's connection on uninstall", async () => {
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "whsec");
    const revoke = vi.fn(async () => {});
    vi.doMock("@/lib/github/install", () => ({ revokeGithubInstallation: revoke, githubReposRemoved: vi.fn() }));
    vi.resetModules();
    const { POST } = await import("@/app/api/github/webhook/app/route");
    const body = JSON.stringify({ action: "deleted", installation: { id: 77 } });
    const sig = (s: string) => `sha256=${createHmac("sha256", s).update(body).digest("hex")}`;
    const req = (signature: string) => new Request("https://pma.example/api/github/webhook/app", { method: "POST", body, headers: { "x-github-event": "installation", "x-hub-signature-256": signature } });
    expect((await POST(req(sig("wrong")))).status).toBe(401);
    expect(revoke).not.toHaveBeenCalled();
    expect((await POST(req(sig("whsec")))).status).toBe(200);
    expect(revoke).toHaveBeenCalledWith("77", expect.stringContaining("uninstalled"));
    vi.doUnmock("@/lib/github/install");
  });
});

describe("the App's webhook, for Build it", () => {
  it("hands pull_request events to the issue rules and keeps accepted permissions", async () => {
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "whsec");
    const onPullRequest = vi.fn(async () => ({ shipped: ["i-a"], linked: [], closed: 0, reopened: 0 }));
    const permissions = vi.fn(async () => {});
    vi.doMock("@/lib/build/pullEvents", () => ({ onPullRequest }));
    vi.doMock("@/lib/slack/hooks", () => ({ slackSyncLater: vi.fn() }));
    vi.doMock("@/lib/github/install", () => ({ revokeGithubInstallation: vi.fn(), githubReposRemoved: vi.fn(), githubPermissionsChanged: permissions }));
    vi.resetModules();
    const { POST } = await import("@/app/api/github/webhook/app/route");
    const send = (event: string, payload: object) => {
      const body = JSON.stringify(payload);
      return POST(new Request("https://pma.example/api/github/webhook/app", { method: "POST", body, headers: { "x-github-event": event, "x-hub-signature-256": `sha256=${createHmac("sha256", "whsec").update(body).digest("hex")}` } }));
    };
    const merged = await send("pull_request", { action: "closed", installation: { id: 77 }, repository: { full_name: "acme/web" }, pull_request: { number: 5, merged: true, body: "PMA: aa11bb" } });
    expect(await merged.json()).toMatchObject({ ok: true, shipped: ["i-a"] });
    expect(onPullRequest).toHaveBeenCalledWith({ action: "closed", installationId: "77", repo: "acme/web", number: 5, merged: true, body: "PMA: aa11bb" });
    await send("installation", { action: "new_permissions_accepted", installation: { id: 77, permissions: { contents: "write", pull_requests: "write" } } });
    expect(permissions).toHaveBeenCalledWith("77", { contents: "write", pull_requests: "write" });
    for (const m of ["@/lib/build/pullEvents", "@/lib/slack/hooks", "@/lib/github/install"]) vi.doUnmock(m);
  });
});
