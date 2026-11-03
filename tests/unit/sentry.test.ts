// Sentry (src/lib/sentry/*): the token and address checks, the read-only API client (regions, the Link header), what an
// issue and a feedback read as, connecting with one or several projects, and what sentry_sync stores. No Sentry is
// called for real: fetch is a fake that answers like Sentry does.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "./fakeDb";

const h = vi.hoisted(() => ({
  conns: new Map<string, Record<string, unknown>>(),
  secrets: new Map<string, unknown>(),
  enqueued: [] as { projectId: string; input: Record<string, unknown> }[],
}));

vi.mock("@/lib/connections/store", () => ({
  saveConnection: vi.fn(async (kind: string, scope: { orgId: string; projectId: string }, f: { status: string; display?: object; config?: object }) => {
    const prev = h.conns.get(kind) ?? { id: `conn-${kind}`, org_id: scope.orgId, project_id: scope.projectId, kind, display: {}, config: {} };
    const next = { ...prev, status: f.status, ...(f.display ? { display: f.display } : {}), ...(f.config ? { config: f.config } : {}) };
    h.conns.set(kind, next);
    return next;
  }),
  findConnection: vi.fn(async (kind: string) => h.conns.get(kind) ?? null),
  putSecret: vi.fn(async (id: string, s: unknown) => { h.secrets.set(id, s); }),
  readSecretJson: vi.fn(async (id: string) => h.secrets.get(id) ?? null),
  markConnection: vi.fn(async () => {}),
  audit: vi.fn(async () => {}),
  last4: (s: string) => s.slice(-4),
}));
vi.mock("@/lib/ingest/enqueue", () => ({
  enqueueSource: vi.fn(async (projectId: string, input: Record<string, unknown>) => {
    h.enqueued.push({ projectId, input });
    return { id: `src-${h.enqueued.length}`, duplicate: input.hashKey === "sentry:999" };
  }),
}));

import { feedbackOf, issueOf, nextLink, regionUrlFor, sentryApi, sentryBaseUrl, sentryErrorText, SentryError, sentryTokenProblem } from "@/lib/sentry/client";
import { chooseSentryProject, saveSentryToken } from "@/lib/sentry/connection";
import { ERRORS_QUERY, FEEDBACK_QUERY, feedbackSource, signalRows, syncSentry } from "@/lib/sentry/sync";
import { rankErrors } from "@/lib/posthog/errors";
import { feedbackSourceRows } from "@/lib/health";

const json = (body: unknown, init: { status?: number; link?: string } = {}) =>
  new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { "content-type": "application/json", ...(init.link ? { link: init.link } : {}) } });
const TOKEN = "sntryu_" + "a".repeat(40);
const scope = { orgId: "org-1", projectId: "app-1", userId: "u-1" };

beforeEach(() => { h.conns.clear(); h.secrets.clear(); h.enqueued.length = 0; });

describe("checking what an admin pastes", () => {
  it("refuses an organization token, which can't read issues, and anything that isn't a token", () => {
    expect(sentryTokenProblem("sntrys_" + "b".repeat(40))).toMatch(/organization token/);
    expect(sentryTokenProblem("not a token")).toMatch(/doesn't look like a Sentry token/);
    expect(sentryTokenProblem(TOKEN)).toBeNull();
    expect(sentryTokenProblem("f".repeat(64))).toBeNull(); // an internal integration's token has no prefix
  });

  it("takes a self-hosted address only as a public https origin", () => {
    expect(sentryBaseUrl("https://sentry.example.com/organizations/acme/")).toBe("https://sentry.example.com");
    for (const bad of ["http://sentry.example.com", "https://localhost", "https://10.0.0.5", "https://[::1]", "https://user:pw@sentry.example.com", "https://intranet", "https://sentry.internal", "nope"]) {
      expect(sentryBaseUrl(bad), bad).toBeNull();
    }
  });

  it("follows an organization's region only within the Sentry the token was checked on", () => {
    expect(regionUrlFor("https://sentry.io", "https://de.sentry.io")).toBe("https://de.sentry.io");
    expect(regionUrlFor("https://sentry.io", "https://evil.example.com")).toBe("https://sentry.io");
    expect(regionUrlFor("https://sentry.io", "http://us.sentry.io")).toBe("https://sentry.io");
    expect(regionUrlFor("https://sentry.example.com", "https://sentry.example.com")).toBe("https://sentry.example.com");
    expect(regionUrlFor("https://sentry.example.com", "https://de.sentry.io")).toBe("https://sentry.example.com");
    expect(regionUrlFor("https://sentry.io", undefined)).toBe("https://sentry.io");
  });

  it("says in plain words why Sentry refused", () => {
    expect(sentryErrorText(new SentryError(401, "x"))).toMatch(/didn't accept that token/);
    expect(sentryErrorText(new SentryError(403, "x"))).toMatch(/org:read, project:read and event:read/);
    expect(sentryErrorText(new Error("boom"))).toMatch(/Couldn't reach Sentry/);
  });
});

describe("the API client", () => {
  it("reads the next page from the Link header until results run out", () => {
    const more = '<https://sentry.io/api/0/x/?cursor=0:0:1>; rel="previous"; results="false"; cursor="0:0:1", <https://sentry.io/api/0/x/?cursor=0:100:0>; rel="next"; results="true"; cursor="0:100:0"';
    expect(nextLink(more)).toBe("https://sentry.io/api/0/x/?cursor=0:100:0");
    expect(nextLink(more.replace('results="true"', 'results="false"'))).toBeNull();
    expect(nextLink(null)).toBeNull();
  });

  it("lists organizations with their regions, then each one's projects in that region, with the token", async () => {
    const f = vi.fn(async (url: string) => {
      if (url === "https://sentry.io/api/0/organizations/") return json([{ slug: "acme", name: "Acme", links: { regionUrl: "https://de.sentry.io" } }]);
      if (url === "https://de.sentry.io/api/0/organizations/acme/projects/") {
        return json([{ id: "11", slug: "web", name: "Web" }], { link: '<https://de.sentry.io/api/0/organizations/acme/projects/?cursor=0:1:0>; rel="next"; results="true"; cursor="0:1:0"' });
      }
      if (url.endsWith("cursor=0:1:0")) return json([{ id: "12", slug: "ios", name: "iOS" }]);
      return json({}, { status: 404 });
    });
    const api = sentryApi(TOKEN, f as unknown as typeof fetch);
    const [org] = await api.organizations("https://sentry.io");
    expect(org).toEqual({ slug: "acme", name: "Acme", regionUrl: "https://de.sentry.io" });
    expect((await api.projects(org)).map((p) => p.slug)).toEqual(["web", "ios"]);
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({ authorization: `Bearer ${TOKEN}` });
  });

  it("asks for a project's issues over a period, most people first, and reads them defensively", async () => {
    const f = vi.fn(async () => json([
      { id: "4001", shortId: "WEB-1", title: "TypeError: chart is undefined", culprit: "ChartScreen", permalink: "https://acme.sentry.io/issues/4001/", count: "57", userCount: 21, lastSeen: "2026-10-20T08:00:00Z", issueCategory: "error" },
      { id: "not-a-number", title: "dropped" },
    ]));
    const issues = await sentryApi(TOKEN, f as unknown as typeof fetch).issues({ slug: "acme", regionUrl: "https://us.sentry.io" }, "11", ERRORS_QUERY);
    const url = new URL((f.mock.calls[0] as unknown as [string])[0]);
    expect(url.origin + url.pathname).toBe("https://us.sentry.io/api/0/organizations/acme/issues/");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ project: "11", query: "is:unresolved issue.category:error", statsPeriod: "30d", sort: "user" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ id: "4001", title: "TypeError: chart is undefined", count: 57, userCount: 21, category: "error" });
  });

  it("keeps a permalink only when it is https", () => {
    expect(issueOf({ id: "1", title: "t", permalink: "javascript:alert(1)" })?.permalink).toBeNull();
  });

  it("finds what someone wrote in a feedback, and who they are when they said", () => {
    const fb = issueOf({ id: "77", title: "User Feedback", metadata: { message: "The chart shows the wrong rising sign", name: "Maya", contact_email: "maya@example.com" } })!;
    expect(feedbackOf(fb)).toEqual({ message: "The chart shows the wrong rising sign", name: "Maya", email: "maya@example.com" });
    expect(feedbackOf(issueOf({ id: "78", title: "User Feedback", metadata: {} })!)).toBeNull();
    expect(feedbackOf(issueOf({ id: "79", title: "Love the moon phase", metadata: {} })!)?.message).toBe("Love the moon phase");
  });
});

describe("connecting", () => {
  const twoProjects = vi.fn(async (url: string) => {
    if (url.endsWith("/api/0/organizations/")) return json([{ slug: "acme", name: "Acme", links: { regionUrl: "https://us.sentry.io" } }]);
    if (url.endsWith("/projects/")) return json([{ id: "11", slug: "web", name: "Web" }, { id: "12", slug: "ios", name: "iOS" }]);
    return json([]);
  });

  it("keeps the projects for the admin to pick when the token reaches several, and stores the token only in Vault", async () => {
    const r = await saveSentryToken(scope, TOKEN, { f: twoProjects as unknown as typeof fetch, db: {} as never });
    expect(r).toEqual({ ok: true, connected: false, projects: [{ key: "acme/web", label: "Acme / Web" }, { key: "acme/ios", label: "Acme / iOS" }] });
    const conn = h.conns.get("sentry")!;
    expect(conn.status).toBe("pending");
    expect(JSON.stringify(conn)).not.toContain(TOKEN);
    expect(h.secrets.get("conn-sentry")).toEqual({ token: TOKEN });
  });

  it("connects the picked project once its issues can be read, in its region", async () => {
    await saveSentryToken(scope, TOKEN, { f: twoProjects as unknown as typeof fetch, db: {} as never });
    expect(await chooseSentryProject(scope, "acme/zzz", { f: twoProjects as unknown as typeof fetch, db: {} as never })).toEqual({ ok: false, error: "Pick one of the projects listed." });
    expect(await chooseSentryProject(scope, "acme/ios", { f: twoProjects as unknown as typeof fetch, db: {} as never })).toEqual({ ok: true, project: "Acme / iOS" });
    const conn = h.conns.get("sentry")!;
    expect(conn.status).toBe("ok");
    expect(conn.config).toMatchObject({ base_url: "https://sentry.io", org_slug: "acme", region_url: "https://us.sentry.io", project_id: "12", project_name: "iOS" });
    expect((conn.config as { projects?: unknown }).projects).toBeUndefined();
    expect(conn.display).toMatchObject({ org: "Acme", project: "iOS", last4: "aaaa" });
  });

  it("connects at once when the token reaches one project, and refuses before saving when Sentry says no", async () => {
    const one = vi.fn(async (url: string) => url.endsWith("/api/0/organizations/") ? json([{ slug: "acme", name: "Acme" }]) : url.endsWith("/projects/") ? json([{ id: "11", slug: "web", name: "Web" }]) : json([]));
    expect(await saveSentryToken(scope, TOKEN, { f: one as unknown as typeof fetch, db: {} as never })).toEqual({ ok: true, connected: true, project: "Acme / Web" });
    h.conns.clear();
    const refused = vi.fn(async () => json({ detail: "Invalid token" }, { status: 401 }));
    expect(await saveSentryToken(scope, TOKEN, { f: refused as unknown as typeof fetch, db: {} as never })).toEqual({ ok: false, error: expect.stringMatching(/didn't accept that token/) });
    expect(h.conns.has("sentry")).toBe(false);
  });
});

describe("sentry_sync", () => {
  const config = { base_url: "https://sentry.io", org_slug: "acme", org_name: "Acme", region_url: "https://us.sentry.io", project_id: "11", project_slug: "web", project_name: "Web" };
  const error = issueOf({ id: "4001", title: "TypeError: chart is undefined", permalink: "https://acme.sentry.io/issues/4001/", count: "57", userCount: 21, lastSeen: "2026-10-20T08:00:00Z" })!;

  it("stores each error's people and events as a signal, linked to the issue it was linked to", () => {
    const rows = signalRows("app-1", [error], new Map([["4001", "issue-9"]]), "2026-10-21T00:00:00Z");
    expect(rows).toEqual([{
      project_id: "app-1", provider: "sentry", kind: "exception", key: "4001", label: "TypeError: chart is undefined", url: "https://acme.sentry.io/issues/4001/",
      issue_id: "issue-9", users_30d: 21, events_30d: 57, last_seen_at: "2026-10-20T08:00:00Z", refreshed_at: "2026-10-21T00:00:00Z",
    }]);
  });

  it("turns a feedback into a source keyed by its Sentry id, so it is read once however often it is synced", () => {
    const fb = issueOf({ id: "77", title: "User Feedback", firstSeen: "2026-10-19T10:00:00Z", metadata: { message: "Restore purchase does nothing", contact_email: "noah@example.com" } })!;
    expect(feedbackSource(fb)).toMatchObject({ kind: "sentry", raw_text: "Restore purchase does nothing", author: "noah@example.com", channel: "Sentry user feedback", occurred_at: "2026-10-19T10:00:00Z", hashKey: "sentry:77" });
    expect(feedbackSource(issueOf({ id: "78", title: "User Feedback" })!)).toBeNull();
  });

  it("refreshes the signals, drops errors that went quiet, and queues only new feedback", async () => {
    const state = fakeDb({ issue_links: [{ project_id: "app-1", provider: "sentry", issue_id: "issue-9", external_id: "4001" }] });
    const asked: string[] = [];
    const api = {
      issues: vi.fn(async (_org: unknown, _project: string, query: string) => {
        asked.push(query);
        return query === FEEDBACK_QUERY
          ? [issueOf({ id: "77", title: "User Feedback", metadata: { message: "Love the moon phase card" } })!, issueOf({ id: "999", title: "User Feedback", metadata: { message: "Seen before" } })!]
          : [error];
      }),
    };
    const r = await syncSentry("app-1", { api: api as never, config }, state.db as never, Date.parse("2026-10-21T00:00:00Z"));
    expect(asked.sort()).toEqual([ERRORS_QUERY, FEEDBACK_QUERY].sort());
    expect(r).toEqual({ errors: 1, feedback: 2, queued: ["src-1"] });
    const upsert = state.writes.find((w) => w.table === "issue_signals" && w.op === "upsert")!.values as Record<string, unknown>[];
    expect(upsert).toEqual([expect.objectContaining({ provider: "sentry", key: "4001", issue_id: "issue-9", users_30d: 21 })]);
    expect(state.writes.some((w) => w.table === "issue_signals" && w.op === "delete")).toBe(true);
    expect(h.enqueued.map((e) => e.input.hashKey)).toEqual(["sentry:77", "sentry:999"]);
  });
});

describe("Sentry beside the other tools", () => {
  it("ranks Sentry errors for an issue with the same rule as PostHog's", () => {
    const ranked = rankErrors({ title: "Chart screen crashes", problem: null }, [{ id: "1", label: "Timeout in CheckoutForm", users: 50 }, { id: "2", label: "TypeError in ChartScreen", users: 3 }]);
    expect(ranked.map((e) => e.id)).toEqual(["2", "1"]);
  });

  it("lists Sentry with a customer app's feedback sources", () => {
    expect(feedbackSourceRows({ slackLive: false, widgetOrigins: 0, customer: true, sentryLive: true }).find((r) => r.name === "Sentry")).toMatchObject({ state: "Live" });
    expect(feedbackSourceRows({ slackLive: false, widgetOrigins: 0, customer: true }).find((r) => r.name === "Sentry")).toMatchObject({ state: "Not connected" });
  });
});
