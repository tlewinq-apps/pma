// Connect with GitHub's two hand-off routes. /api/github/setup trusts nothing in GitHub's redirect until the hand-off
// is this person's (state from the URL or the install cookie), then sends them to sign in with PKCE; /api/github/callback
// saves only the installation id the setup step put in the state, never one from its own URL.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  taken: null as null | { ok: true; state: Record<string, unknown> } | { ok: false; reason: string },
  takenWith: [] as (string | null)[],
  started: [] as Record<string, unknown>[],
  cookie: null as string | null,
  saved: [] as unknown[][],
  saveResult: { ok: true, account: "acme" } as { ok: boolean; account?: string; reason?: string },
}));

vi.mock("@/lib/db/app", () => ({ requireUser: async () => ({ userId: "u1", email: "a@b.c" }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (h.cookie ? { value: h.cookie } : undefined) }) }));
vi.mock("@/lib/connections/oauth", async (orig) => ({
  ...(await orig<typeof import("@/lib/connections/oauth")>()),
  takeOAuth: async (_p: string, state: string | null) => { h.takenWith.push(state); return h.taken; },
  startOAuth: async (s: Record<string, unknown>) => { h.started.push(s); return { state: "next-state", challenge: "chal" }; },
}));
vi.mock("@/lib/github/install", async (orig) => ({
  ...(await orig<typeof import("@/lib/github/install")>()),
  exchangeGithubCode: async (code: string, verifier: string) => `token-for-${code}-${verifier}`,
  saveGithubInstallation: async (...a: unknown[]) => { h.saved.push(a); return h.saveResult; },
}));

vi.mock("@/lib/github/autoConnect", () => ({ connectOnlyRepository: async () => null }));

import { GET as setup } from "@/app/api/github/setup/route";
import { GET as callback } from "@/app/api/github/callback/route";

const state = { provider: "github", org_id: "org-a", project_id: "app-a", user_id: "u1", code_verifier: "ver", return_to: "/acme/web/welcome#setup", data: {}, expires_at: "" };
const loc = (r: Response) => r.headers.get("location") ?? "";

beforeEach(() => {
  vi.stubEnv("GITHUB_APP_CLIENT_ID", "Iv1.client");
  vi.stubEnv("APP_URL", "https://pma.example");
  h.taken = { ok: true, state }; h.takenWith = []; h.started = []; h.cookie = null; h.saved = []; h.saveResult = { ok: true, account: "acme" };
});

describe("/api/github/setup", () => {
  it("takes the state from the install cookie when GitHub doesn't echo it, then signs in with PKCE carrying the installation", async () => {
    h.cookie = "cookie-state";
    const r = await setup(new Request("https://pma.example/api/github/setup?installation_id=77&setup_action=install"));
    expect(h.takenWith).toEqual(["cookie-state"]);
    expect(h.started[0]).toMatchObject({ provider: "github", orgId: "org-a", projectId: "app-a", userId: "u1", pkce: true, data: { installation_id: "77" } });
    const u = new URL(loc(r));
    expect(`${u.origin}${u.pathname}`).toBe("https://github.com/login/oauth/authorize");
    expect(u.searchParams.get("state")).toBe("next-state");
    expect(u.searchParams.get("code_challenge")).toBe("chal");
    expect(r.headers.get("set-cookie")).toMatch(/pma_gh_install=;/);
  });

  it("goes back with the reason when the hand-off isn't this person's, or isn't one", async () => {
    h.taken = { ok: false, reason: "wrong_user" };
    expect(loc(await setup(new Request("https://pma.example/api/github/setup?installation_id=77&state=x")))).toBe("https://pma.example/?connect=github&error=wrong_user");
    expect(h.started).toEqual([]);
  });

  it("says an organization's owners were asked, and refuses an installation id that isn't a number", async () => {
    expect(loc(await setup(new Request("https://pma.example/api/github/setup?setup_action=request&state=s")))).toBe("https://pma.example/acme/web/welcome?connect=github&error=requested#setup");
    h.taken = { ok: true, state };
    expect(loc(await setup(new Request("https://pma.example/api/github/setup?installation_id=77x&state=s")))).toContain("error=failed");
    expect(h.started).toEqual([]);
  });
});

describe("/api/github/callback", () => {
  it("saves the installation the setup step put in the state, with the person's token, and goes back with ok", async () => {
    h.taken = { ok: true, state: { ...state, data: { installation_id: "77" } } };
    const r = await callback(new Request("https://pma.example/api/github/callback?code=c1&state=next-state&installation_id=999"));
    expect(h.saved[0].slice(0, 2)).toEqual(["77", "token-for-c1-ver"]); // never the 999 in its own URL
    expect(loc(r)).toBe("https://pma.example/acme/web/welcome?connect=github&ok=1#setup");
  });

  it("goes back with GitHub's cancel, a missing code, or what saving refused", async () => {
    h.taken = { ok: true, state: { ...state, data: { installation_id: "77" } } };
    expect(loc(await callback(new Request("https://pma.example/api/github/callback?error=access_denied&state=s")))).toContain("error=denied");
    h.taken = { ok: true, state: { ...state, data: { installation_id: "77" } } };
    expect(loc(await callback(new Request("https://pma.example/api/github/callback?state=s")))).toContain("error=failed");
    h.taken = { ok: true, state: { ...state, data: { installation_id: "77" } } };
    h.saveResult = { ok: false, reason: "not_yours" };
    expect(loc(await callback(new Request("https://pma.example/api/github/callback?code=c&state=s")))).toContain("error=not_yours");
  });
});
