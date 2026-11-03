// PostHog (src/lib/posthog/*): sign-in by Client ID Metadata Document with PKCE, a rate-limited API client that
// refreshes OAuth tokens, the posthog_sync queries and what they store, and ranking errors for an issue. No PostHog is
// called for real: fetch is a fake that answers like PostHog does.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "./fakeDb";
import { PostHogApi, PostHogError, RateLimiter } from "@/lib/posthog/client";
import { posthogAuthorizeUrl, posthogClientMetadata, exchangePosthogCode } from "@/lib/posthog/oauth";
import { ERROR_ID, exceptionQuery, PATH_QUERY, syncSignals } from "@/lib/posthog/sync";
import { errorLabel, rankErrors } from "@/lib/posthog/errors";
import { pathMatches, pathsForFrames, posthogUsersByIssue, reachFrom } from "@/lib/posthog/reach";
import { analyseIssue, type AnalysisInput } from "@/lib/analysis";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => vi.stubEnv("APP_URL", "https://pma.example.com"));

describe("signing in with PostHog", () => {
  it("serves a metadata document whose client_id is its own URL, as a public PKCE client", () => {
    const m = posthogClientMetadata();
    expect(m.client_id).toBe("https://pma.example.com/oauth/posthog-client.json");
    expect(m.redirect_uris).toEqual(["https://pma.example.com/api/posthog/oauth/callback"]);
    expect(m.token_endpoint_auth_method).toBe("none");
    expect(m.client_name).toBe("PMA");
  });

  it("asks for one project, read-only scopes and an S256 challenge, on the right region", () => {
    const u = new URL(posthogAuthorizeUrl("eu", "st", "ch"));
    expect(u.origin + u.pathname).toBe("https://eu.posthog.com/oauth/authorize/");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      client_id: "https://pma.example.com/oauth/posthog-client.json", response_type: "code", state: "st", code_challenge: "ch",
      code_challenge_method: "S256", required_access_level: "project", scope: "project:read query:read error_tracking:read",
    });
  });

  it("swaps the code with the PKCE verifier and keeps the picked project", async () => {
    const f = vi.fn(async () => json({ access_token: "pha_1", refresh_token: "phr_1", expires_in: 3600, scoped_teams: [42] }));
    const r = await exchangePosthogCode("us", "code-1", "verifier-1", f as unknown as typeof fetch);
    expect(r).toMatchObject({ creds: { kind: "oauth", access_token: "pha_1", refresh_token: "phr_1" }, scopedProjects: [42] });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://us.posthog.com/oauth/token/");
    expect(Object.fromEntries(new URLSearchParams(init.body as string))).toMatchObject({ grant_type: "authorization_code", code: "code-1", code_verifier: "verifier-1", client_id: "https://pma.example.com/oauth/posthog-client.json" });
  });
});

describe("the rate limiter", () => {
  it("never runs more than 3 at once", async () => {
    const l = new RateLimiter(240, 3);
    let peak = 0;
    const job = () => l.run(async () => { peak = Math.max(peak, l.inFlight); await new Promise((r) => setTimeout(r, 5)); });
    await Promise.all(Array.from({ length: 10 }, job));
    expect(peak).toBe(3);
  });

  it("allows 240 a minute, then waits for the bucket to refill", async () => {
    let t = 0;
    const slept: number[] = [];
    const l = new RateLimiter(240, 3, () => t, async (ms) => { slept.push(ms); t += ms; });
    for (let i = 0; i < 240; i++) await l.run(async () => {});
    expect(slept).toEqual([]);
    await l.run(async () => {});
    expect(slept).toEqual([250]); // one request's worth: 60 s / 240
  });
});

describe("the API client", () => {
  it("runs HogQL queries against the project, with the key as a bearer token", async () => {
    const f = vi.fn(async () => json({ columns: ["path"], results: [["/x"]] }));
    const api = new PostHogApi("https://us.posthog.com", { kind: "key", key: "phx_abc" }, { fetch: f as unknown as typeof fetch });
    expect(await api.query(7, "select 1")).toEqual({ columns: ["path"], results: [["/x"]] });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://us.posthog.com/api/projects/7/query/");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer phx_abc");
    expect(JSON.parse(init.body as string)).toEqual({ query: { kind: "HogQLQuery", query: "select 1" } });
  });

  it("refreshes an expired OAuth token once, saves the new pair and retries", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ detail: "expired" }, 401)).mockResolvedValueOnce(json({ id: 7, name: "Web" }));
    const refresh = vi.fn(async () => ({ kind: "oauth" as const, access_token: "pha_2", refresh_token: "phr_2", expires_at: null }));
    const onRefresh = vi.fn(async () => {});
    const api = new PostHogApi("https://us.posthog.com", { kind: "oauth", access_token: "pha_1", refresh_token: "phr_1", expires_at: null }, { fetch: f as unknown as typeof fetch, refresh, onRefresh });
    expect(await api.project(7)).toEqual({ id: 7, name: "Web" });
    expect(refresh).toHaveBeenCalledWith("phr_1");
    expect(onRefresh).toHaveBeenCalledWith(expect.objectContaining({ access_token: "pha_2" }));
    expect(((f.mock.calls[1] as unknown as [string, RequestInit])[1].headers as Record<string, string>).authorization).toBe("Bearer pha_2");
  });

  it("reports a refused credential as denied", async () => {
    const api = new PostHogApi("https://us.posthog.com", { kind: "key", key: "phx_x" }, { fetch: (async () => json({ detail: "nope" }, 403)) as unknown as typeof fetch });
    const e = await api.project(1).catch((x) => x);
    expect(e).toBeInstanceOf(PostHogError);
    expect((e as PostHogError).denied).toBe(true);
  });
});

describe("posthog_sync", () => {
  it("never puts an unsafe error id into a query", () => {
    expect(exceptionQuery(["0190-abc", "x'); drop table events; --", "0190-abc"])).toBe(
      "SELECT properties.$exception_issue_id AS id, count(DISTINCT person_id) AS users, count() AS events, max(timestamp) AS last_seen FROM events WHERE event = '$exception' AND timestamp > now() - INTERVAL 30 DAY AND properties.$exception_issue_id IN ('0190-abc') GROUP BY id");
    expect(exceptionQuery(["a b"])).toBeNull();
    expect(ERROR_ID.test("01923f2a-7c3d-7b1e-9c1a-5e6f7a8b9c0d")).toBe(true);
    expect(PATH_QUERY("$rageclick")).toContain("event = '$rageclick'");
  });

  it("counts people per linked error, rage clicks and page views by path, and stores them for the app", async () => {
    const state = fakeDb({ issue_links: [{ project_id: "app-1", issue_id: "issue-1", external_id: "err-1", provider: "posthog" }] });
    const queries: string[] = [];
    const api = { query: async (_p: number, q: string) => {
      queries.push(q);
      if (q.includes("'$pageview'")) return { columns: [], results: [["/checkout", 120, 400, "2026-10-15T10:00:00Z"]] };
      if (q.includes("'$rageclick'")) return { columns: [], results: [["/checkout/pay", 9, 31, "2026-10-15T10:00:00Z"]] };
      return { columns: [], results: [["err-1", 14, 22, "2026-10-16T08:00:00Z"]] };
    } } as unknown as PostHogApi;
    expect(await syncSignals("app-1", api, { region: "us", project_id: 7, project_name: "Web", auth: "key" }, state.db as never)).toEqual({ pageviews: 1, rageclicks: 1, errors: 1 });
    expect(queries).toHaveLength(3);
    const upsert = state.writes.find((w) => w.table === "issue_signals" && w.op === "upsert")!.values as Record<string, unknown>[];
    expect(upsert).toEqual([
      expect.objectContaining({ project_id: "app-1", kind: "pageview", key: "/checkout", users_30d: 120, issue_id: null }),
      expect.objectContaining({ kind: "rageclick", key: "/checkout/pay", users_30d: 9 }),
      expect.objectContaining({ kind: "exception", key: "err-1", users_30d: 14, issue_id: "issue-1" }),
    ]);
    expect(state.writes.some((w) => w.table === "issue_signals" && w.op === "delete")).toBe(true);
  });

  it("skips the error query when no error is linked yet", async () => {
    const state = fakeDb({ issue_links: [] });
    const query = vi.fn(async () => ({ columns: [], results: [] }));
    await syncSignals("app-1", { query } as unknown as PostHogApi, { region: "us", project_id: 7, project_name: "Web", auth: "key" }, state.db as never);
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe("errors next to an issue", () => {
  it("names an error from PostHog's arrays, however they come back", () => {
    expect(errorLabel(["TypeError"], ["x is undefined"])).toBe("TypeError: x is undefined");
    expect(errorLabel('["RangeError"]', '["Invalid date"]')).toBe("RangeError: Invalid date");
    expect(errorLabel(null, null)).toBe("Unnamed error");
  });

  it("puts errors sharing the issue's words first, then by people affected", () => {
    const errors = [
      { id: "a", label: "TypeError: cannot read total of undefined in Cart", users: 50, events: 90, lastSeen: null },
      { id: "b", label: "RangeError: Invalid checkout date in PaymentForm", users: 4, events: 4, lastSeen: null },
      { id: "c", label: "NetworkError: fetch failed", users: 80, events: 200, lastSeen: null },
    ];
    expect(rankErrors({ title: "Checkout payment date crashes", problem: "The payment form breaks when picking a date" }, errors).map((e) => [e.id, e.score])).toEqual([["b", 4], ["c", 0], ["a", 0]]);
  });

  it("maps rage-click paths to the issue's screens through the route map", () => {
    const paths = pathsForFrames({ "/checkout": "checkout/index", "/home": "home/index" }, ["checkout/index"]);
    expect(paths).toEqual(["/checkout"]);
    expect(pathMatches("/checkout/pay", paths)).toBe(true);
    expect(pathMatches("/checkouts", paths)).toBe(false);
  });
});

describe("PostHog users lift urgency", () => {
  const APP = "11111111-1111-4111-8111-111111111111";
  const signals = [
    { project_id: APP, kind: "exception", key: "err-1", users_30d: 120 },
    { project_id: APP, kind: "exception", key: "err-2", users_30d: 7 },
    { project_id: APP, kind: "rageclick", key: "/checkout/pay", users_30d: 30 },
    { project_id: APP, kind: "rageclick", key: "/home", users_30d: 500 },
  ];

  it("counts people on the linked errors plus rage clicks on the issue's screens, each signal once", () => {
    expect(reachFrom(signals, ["err-1", "err-1"], ["/checkout"])).toEqual({ users: 150, errors: 120, rageclicks: 30 });
    expect(reachFrom(signals, [], [])).toEqual({ users: 0, errors: 0, rageclicks: 0 });
  });

  it("reads every issue's users for the Desk from the app's signals, links and route map", async () => {
    const { db } = fakeDb({
      issue_signals: signals,
      issue_links: [{ project_id: APP, provider: "posthog", issue_id: "i1", external_id: "err-1" }, { project_id: APP, provider: "posthog", issue_id: "i2", external_id: "err-2" }],
      projects: [{ id: APP, route_map: { "/checkout": "checkout/index" } }],
    });
    const users = await posthogUsersByIssue(db as never, APP, [{ id: "i1", frames: ["checkout/index"] }, { id: "i2", frames: [] }, { id: "i3", frames: ["home/index"] }]);
    expect(Object.fromEntries(users)).toEqual({ i1: 150, i2: 7 });
  });

  it("reads nobody, and nothing more, for an app without PostHog data", async () => {
    const { db, reads } = fakeDb({ issue_signals: [], issue_links: [], projects: [{ id: APP, route_map: {} }] });
    expect((await posthogUsersByIssue(db as never, APP, [{ id: "i1", frames: [] }])).size).toBe(0);
    expect(reads.map((r) => r.table)).toEqual(["issue_signals"]);
  });

  it("moves Why it matters' urgency within its band and says why", () => {
    const now = Date.parse("2026-10-17T12:00:00Z");
    const input = (phUsers30: number): AnalysisInput => ({
      type: "bug", breakdown: { severity: 4, clarity: 4, scope: "single_screen", reach: 0.5, rationale: { severity: "Blocks checkout." } }, ease: 50, peopleCount: 1,
      units: [{ sentiment: -2, emotion: "frustrated", audience: null, speakers: ["Ana"], at: "2026-10-16T12:00:00Z" }],
      screens: [], finding: null, recommended: null, phUsers30,
    });
    const without = analyseIssue(input(0), now)!.urgency;
    const withPh = analyseIssue(input(500), now)!.urgency;
    expect(withPh.score).toBeGreaterThan(without.score);
    expect(withPh.reasons.map((r) => r.lead)).toContain("500 PostHog users in 30 days");
    expect(without.reasons.map((r) => r.lead).join(" ")).not.toMatch(/PostHog/);
  });
});
