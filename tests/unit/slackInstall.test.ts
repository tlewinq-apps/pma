// "Add to Slack" (src/lib/connections/oauth.ts, src/lib/slack/install.ts): the OAuth state is single-use, short-lived
// and tied to the person who started it; a finished install stores the bot token in Vault and ties the workspace to
// exactly one company. No Slack or database is called for real.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { fakeDb } from "./fakeDb";

const h = vi.hoisted(() => ({
  db: null as unknown,
  authTest: { url: "https://acme.slack.com/", team: "Acme", user_id: "UBOT", team_id: "TA" } as Record<string, string> | null,
  saved: [] as { kind: string; status: string; externalId?: string | null }[],
  secrets: [] as [string, string][],
  dropped: [] as string[],
  audits: [] as string[],
}));
vi.mock("@/lib/db/server", () => ({ serviceDb: () => h.db }));
vi.mock("@/lib/slack/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/slack/api")>()),
  slackCall: async (_t: string | null, method: string) => { if (method === "auth.test" && h.authTest) return h.authTest; throw new Error(method); },
}));
vi.mock("@/lib/connections/store", async (orig) => ({
  ...(await orig<typeof import("@/lib/connections/store")>()),
  saveConnection: async (kind: string, _scope: unknown, f: { status: string; externalId?: string | null }) => { h.saved.push({ kind, status: f.status, externalId: f.externalId }); return { id: "conn-new" }; },
  putSecret: async (id: string, s: string) => { h.secrets.push([id, s]); },
  dropSecret: async (id: string) => { h.dropped.push(id); },
  markConnection: async () => {},
  audit: async (e: { action: string }) => { h.audits.push(e.action); },
}));

import { backTo, pkcePair, safeReturnTo, takeOAuth } from "@/lib/connections/oauth";
import { saveInstallation, slackAuthorizeUrl } from "@/lib/slack/install";

const access = (over: Record<string, unknown> = {}) => ({ access_token: "xoxb-new", scope: "chat:write,commands", bot_user_id: "UBOT", app_id: "A1", team: { id: "TA", name: "Acme" }, enterprise: null, is_enterprise_install: false, ...over });
const who = { orgId: "org-a", projectId: "app-a", userId: "user-1" };

beforeEach(() => {
  h.saved = []; h.secrets = []; h.dropped = []; h.audits = [];
  h.authTest = { url: "https://acme.slack.com/", team: "Acme", user_id: "UBOT", team_id: "TA" };
  vi.stubEnv("APP_URL", "https://pma.example.com");
  vi.stubEnv("SLACK_CLIENT_ID", "123.456");
});

describe("the OAuth hand-off", () => {
  /** A database whose oauth_states delete-and-return answers with `row` (or nothing). */
  const stateDb = (row: Record<string, unknown> | null) => {
    const filters: [string, unknown][] = [];
    const q = { eq: (c: string, v: unknown) => { filters.push([c, v]); return q; }, select: () => q, maybeSingle: async () => ({ data: row, error: null }) };
    return { db: { from: () => ({ delete: () => q }) } as never, filters };
  };
  const row = (over: Record<string, unknown> = {}) => ({ provider: "slack", org_id: "org-a", project_id: "app-a", user_id: "user-1", code_verifier: null, return_to: "/acme/web/settings", data: {}, expires_at: new Date(Date.now() + 60_000).toISOString(), ...over });

  it("takes a state once, by its hash, for the person who started it", async () => {
    const { db, filters } = stateDb(row());
    expect(await takeOAuth("slack", "raw-state", "user-1", db)).toMatchObject({ ok: true, state: { org_id: "org-a" } });
    expect(filters).toContainEqual(["state_hash", createHash("sha256").update("raw-state").digest("hex")]);
    expect(filters).toContainEqual(["provider", "slack"]);
  });

  it("refuses an unknown, expired or someone else's state", async () => {
    expect(await takeOAuth("slack", "x", "user-1", stateDb(null).db)).toEqual({ ok: false, reason: "unknown" });
    expect(await takeOAuth("slack", null, "user-1", stateDb(row()).db)).toEqual({ ok: false, reason: "unknown" });
    expect(await takeOAuth("slack", "x", "user-1", stateDb(row({ expires_at: new Date(Date.now() - 1000).toISOString() })).db)).toEqual({ ok: false, reason: "expired" });
    expect(await takeOAuth("slack", "x", "user-2", stateDb(row()).db)).toEqual({ ok: false, reason: "wrong_user" });
  });

  it("only returns to a path on this site", () => {
    expect(safeReturnTo("/acme/web/welcome#tools")).toBe("/acme/web/welcome#tools");
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil", "javascript:alert(1)", "", null, 3]) expect(safeReturnTo(bad), String(bad)).toBeNull();
    expect(backTo("/acme/web/welcome#tools", "/", { connect: "slack", ok: "1" })).toBe("/acme/web/welcome?connect=slack&ok=1#tools");
  });

  it("makes an S256 PKCE pair", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[\w-]{43}$/);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("sends people to Slack's consent screen for the frozen bot scopes, back to this deployment", () => {
    const u = new URL(slackAuthorizeUrl("st4te"));
    expect(u.origin + u.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(u.searchParams.get("client_id")).toBe("123.456");
    expect(u.searchParams.get("state")).toBe("st4te");
    expect(u.searchParams.get("redirect_uri")).toBe("https://pma.example.com/api/slack/oauth/callback");
    expect(u.searchParams.get("scope")).toContain("groups:write");
  });
});

describe("saving an install", () => {
  const install = (over: Record<string, unknown>) => ({ id: "inst-x", org_id: "org-x", connection_id: "conn-x", team_id: "TX", team_name: "X", status: "active", ...over });

  it("ties a new workspace to the company and keeps the token in Vault", async () => {
    const state = fakeDb({ slack_installations: [] });
    h.db = state.db;
    expect(await saveInstallation(access(), who)).toEqual({ ok: true, team: "Acme" });
    expect(h.secrets).toEqual([["conn-new", "xoxb-new"]]);
    expect(state.writes).toContainEqual(expect.objectContaining({ table: "slack_installations", op: "insert", values: expect.objectContaining({ org_id: "org-a", team_id: "TA", status: "active", scopes: ["chat:write", "commands"] }) }));
    expect(h.saved.at(-1)).toMatchObject({ kind: "slack", status: "ok", externalId: "TA" });
    expect(h.audits).toEqual(["connection.connected"]);
    // The token never goes into a row.
    expect(JSON.stringify(state.writes)).not.toContain("xoxb-new");
  });

  it("refuses a workspace another company already connected, storing nothing", async () => {
    const state = fakeDb({ slack_installations: [install({ org_id: "org-b", team_id: "TA" })] });
    h.db = state.db;
    expect(await saveInstallation(access(), who)).toEqual({ ok: false, reason: "taken" });
    expect(h.secrets).toEqual([]);
    expect(state.writes).toEqual([]);
  });

  it("refuses an org-wide Enterprise Grid install", async () => {
    h.db = fakeDb({ slack_installations: [] }).db;
    expect(await saveInstallation(access({ is_enterprise_install: true, team: null, enterprise: { id: "E1" } }), who)).toEqual({ ok: false, reason: "enterprise" });
    expect(h.secrets).toEqual([]);
  });

  it("refuses a token whose workspace doesn't match what Slack said", async () => {
    h.db = fakeDb({ slack_installations: [] }).db;
    h.authTest = { url: "https://other.slack.com/", team: "Other", user_id: "U", team_id: "TOTHER" };
    expect(await saveInstallation(access(), who)).toEqual({ ok: false, reason: "failed" });
    expect(h.secrets).toEqual([]);
  });

  it("moving the company to another workspace retires the old one and clears its channels", async () => {
    const state = fakeDb({ slack_installations: [install({ id: "inst-old", org_id: "org-a", team_id: "TOLD" })], projects: [{ id: "app-a", org_id: "org-a" }], issues: [{ id: "i1", project_id: "app-a" }] });
    h.db = state.db;
    expect(await saveInstallation(access(), who)).toEqual({ ok: true, team: "Acme" });
    expect(state.writes).toContainEqual(expect.objectContaining({ table: "slack_installations", op: "update", values: expect.objectContaining({ status: "disconnected" }) }));
    expect(state.writes.filter((w) => w.op === "delete").map((w) => w.table)).toEqual(["slack_threads", "slack_posts", "slack_channels"]);
    expect(h.audits).toEqual(["connection.replaced", "connection.connected"]);
  });

  it("reinstalling the same workspace updates it in place", async () => {
    const state = fakeDb({ slack_installations: [install({ id: "inst-a", org_id: "org-a", team_id: "TA" })] });
    h.db = state.db;
    expect(await saveInstallation(access(), who)).toEqual({ ok: true, team: "Acme" });
    expect(state.writes.filter((w) => w.table === "slack_installations").map((w) => w.op)).toEqual(["update"]);
  });
});
