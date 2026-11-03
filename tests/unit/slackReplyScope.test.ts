// Slack is per company: each company installs PMA in its own workspace (slack_installations, token in Vault), and
// each app has its own channels there. Events and clicks are routed by team_id. The demo stays on the deployment's own
// workspace (SLACK_BOT_TOKEN) until it migrates. These tests prove every Slack path works in the right workspace with
// the right token: a reply, a follow-up, a filed note or a DM for one company never goes out with another company's
// token or into another company's channel, an event from one workspace never touches another company's app, and an
// uninstall stops that company's Slack at once. Each case has a control, so "nothing happened" is the guard and not a
// broken fake.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "./fakeDb";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOSLACK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DEMO = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const A_INBOX = "CAINBOX", A_CARDS = "CACARDS", B_INBOX = "CBINBOX", DEMO_INBOX = "CDINBOX";

type Call = { method: string; token: string | undefined; args: Record<string, unknown> };
const h = vi.hoisted(() => ({
  db: null as unknown,
  calls: [] as Call[],
  fail: null as null | ((method: string) => void),
  posts: [] as { channel: string; thread: string | null; token: string | undefined }[],
  ingest: vi.fn(),
  runFlow: vi.fn(),
  secrets: {} as Record<string, string>,
  dropped: [] as string[],
  marked: [] as [string, string][],
}));

vi.mock("@/lib/db/server", () => ({ serviceDb: () => h.db }));
vi.mock("@/lib/connections/store", async (orig) => ({
  ...(await orig<typeof import("@/lib/connections/store")>()),
  readSecret: async (id: string) => h.secrets[id] ?? null,
  dropSecret: async (id: string) => { h.dropped.push(id); },
  markConnection: async (id: string, status: string) => { h.marked.push([id, status]); },
  audit: async () => {},
}));
vi.mock("@/lib/slack/api", async (orig) => {
  const real = await orig<typeof import("@/lib/slack/api")>();
  const { currentSlack } = await import("@/lib/slack/context");
  return {
    ...real,
    slackApi: async (method: string, args: Record<string, unknown> = {}) => {
      h.calls.push({ method, token: currentSlack()?.token, args });
      h.fail?.(method);
      return method === "users.lookupByEmail" ? { user: { id: "U9", real_name: "Owner" } } : { ts: "2.2" };
    },
    // The legacy env token's own team (auth.test) is TLEGACY.
    slackCall: async (_token: string | null, method: string) => (method === "auth.test" ? { team_id: "TLEGACY", user_id: "UBOT", url: "https://legacy.slack.com/", team: "Legacy" } : {}),
    slackTeam: async () => ({ user_id: "UBOT", url: "https://x.slack.com/", team: "X" }),
  };
});
// sync.ts pulls in the image renderer; these tests only need its connection lookups and the post helper.
vi.mock("@/lib/slack/sync", async () => {
  const { currentSlack } = await import("@/lib/slack/context");
  type Row = { project_id: string; role: string; channel_id: string };
  const rows = () => ((h.db as { __tables: Record<string, Row[]> }).__tables.slack_channels ?? []);
  const conn = (projectId: string) => {
    const mine = rows().filter((r) => r.project_id === projectId);
    if (!mine.length) return null;
    return { projectId, customer: null, channels: Object.fromEntries(mine.map((r) => [r.role, { id: r.channel_id, boardTs: null }])), roleOf: new Map(mine.map((r) => [r.channel_id, r.role])) };
  };
  return {
    connectionFor: async (projectId: string) => conn(projectId),
    connectionForChannel: async (channel: string, ids: string[]) => { const r = rows().find((x) => x.channel_id === channel && ids.includes(x.project_id)); return r ? conn(r.project_id) : null; },
    firstConnection: async (ids: string[]) => { const r = rows().find((x) => ids.includes(x.project_id) && x.role === "inbox"); return r ? conn(r.project_id) : null; },
    syncIssueToSlack: vi.fn(async () => {}),
    refreshBoardFor: vi.fn(async () => {}),
    post: async (channel: string, thread: string | null) => { h.posts.push({ channel, thread, token: currentSlack()?.token }); return { ts: "3.3" }; },
    update: vi.fn(async () => ({})),
    getPost: vi.fn(async () => null),
    putPost: vi.fn(async () => {}),
    publishHome: vi.fn(async () => {}),
  };
});
vi.mock("@/lib/slack/hooks", () => ({ slackSyncNow: vi.fn(async () => {}), slackSyncLater: vi.fn() }));
vi.mock("@/lib/slack/inbox", async (orig) => ({
  ...(await orig<typeof import("@/lib/slack/inbox")>()),
  ingestSlackMessage: h.ingest,
  runFeedbackFlow: h.runFlow,
}));

import { askFollowups, followupSourceFor, tellReporters } from "@/lib/slack/reporters";
import { handleEvent } from "@/lib/slack/eventHandlers";
import { slackOnFiled } from "@/lib/slack/inbox";
import { alertsAfterScore } from "@/lib/alerts/send";
import { forgetSlackClients } from "@/lib/slack/tenant";

const slackSource = (id: string, project: string, channel: string, ts = "1.1", via = "inbox") =>
  ({ id, project_id: project, kind: "slack", author: "Alex", channel: "Slack #feedback", metadata: { slack: { channel, ts, user: "U1", via } } });
const issue = (id: string, project: string, sources: ReturnType<typeof slackSource>[]) => ({
  id, project_id: project, title: `Issue ${id}`, type: "bug", importance: 80, people_count: 1, owner_id: "u1", score_breakdown: { reach: 1 }, diagnosis: null,
  followups: { questions: ["Which screen were you on?"] }, projects: { alert_rules: {} },
  feedback_units: sources.map((s) => ({ source_id: s.id, quote: "It spun", created_at: "2026-10-16T09:00:00Z", sources: s })),
});

let state: ReturnType<typeof fakeDb>;
function setTables(tables: Parameters<typeof fakeDb>[0]) {
  const all = {
    projects: [
      { id: A, org_id: "org-a", kind: "customer" }, { id: B, org_id: "org-b", kind: "customer" },
      { id: NOSLACK, org_id: "org-c", kind: "customer" }, { id: DEMO, org_id: "org-demo", kind: "demo" },
    ],
    slack_installations: [
      { id: "inst-a", org_id: "org-a", connection_id: "conn-a", team_id: "TA", team_name: "A", team_url: "https://a.slack.com/", bot_user_id: "UBOTA", status: "active" },
      { id: "inst-b", org_id: "org-b", connection_id: "conn-b", team_id: "TB", team_name: "B", team_url: "https://b.slack.com/", bot_user_id: "UBOTB", status: "active" },
    ],
    slack_channels: [
      { project_id: A, role: "inbox", channel_id: A_INBOX }, { project_id: A, role: "cards", channel_id: A_CARDS },
      { project_id: B, role: "inbox", channel_id: B_INBOX },
      // A company without Slack that still has channel rows from before (or planted): never used.
      { project_id: NOSLACK, role: "inbox", channel_id: "CNOSLACK" },
      { project_id: DEMO, role: "inbox", channel_id: DEMO_INBOX },
    ],
    ...tables,
  };
  state = fakeDb(all, { service_member_emails: [{ user_id: "u1", email: "owner@example.test" }] });
  h.db = Object.assign(state.db, { __tables: all });
}
const methods = () => h.calls.map((c) => c.method);
const tokens = () => [...new Set([...h.calls.map((c) => c.token), ...h.posts.map((p) => p.token)])];

beforeEach(() => {
  process.env.SLACK_BOT_TOKEN = "xoxb-legacy";
  process.env.SLACK_SIGNING_SECRET = "secret";
  h.secrets = { "conn-a": "xoxb-A", "conn-b": "xoxb-B" };
  h.calls = []; h.posts = []; h.dropped = []; h.marked = []; h.fail = null;
  h.ingest.mockReset(); h.runFlow.mockReset();
  forgetSlackClients();
});

describe("telling reporters an issue shipped", () => {
  it("posts in the issue's own workspace with that company's token", async () => {
    setTables({ issues: [issue("i-b", B, [slackSource("s-b", B, B_INBOX)])] });
    expect(await tellReporters("i-b")).toEqual({ told: ["Alex"] });
    expect(h.calls).toEqual([expect.objectContaining({ method: "chat.postMessage", token: "xoxb-B", args: expect.objectContaining({ channel: B_INBOX, thread_ts: "1.1" }) })]);
  });

  it("never posts for an app whose company has no Slack, even when its channel rows are still there", async () => {
    setTables({ issues: [issue("i-c", NOSLACK, [slackSource("s-c", NOSLACK, "CNOSLACK")])] });
    expect(await tellReporters("i-c")).toEqual({ told: [] });
    expect(methods()).toEqual([]);
    expect(state.writes.filter((w) => w.table === "alert_log")).toEqual([]);
  });

  it("skips a source from another app filed under this app's issue", async () => {
    setTables({ issues: [issue("i-a", A, [slackSource("s-planted", B, B_INBOX, "7.7")])] });
    expect(await tellReporters("i-a")).toEqual({ told: [] });
    expect(methods()).toEqual([]);
  });

  it("the demo still posts on the deployment's own workspace", async () => {
    setTables({ issues: [issue("i-d", DEMO, [slackSource("s-d", DEMO, DEMO_INBOX)])] });
    expect(await tellReporters("i-d")).toEqual({ told: ["Alex"] });
    expect(tokens()).toEqual(["xoxb-legacy"]);
  });

  it("stops at once for a company whose workspace was uninstalled", async () => {
    setTables({
      issues: [issue("i-a", A, [slackSource("s-a", A, A_INBOX)])],
      slack_installations: [{ id: "inst-a", org_id: "org-a", connection_id: "conn-a", team_id: "TA", status: "revoked" }],
    });
    expect(await tellReporters("i-a")).toEqual({ told: [] });
    expect(methods()).toEqual([]);
  });
});

describe("asking follow-up questions", () => {
  it("refuses an app without Slack before any Slack call or write", async () => {
    setTables({ issues: [issue("i-c", NOSLACK, [slackSource("s-c", NOSLACK, "CNOSLACK")])] });
    expect(await askFollowups("i-c", "u1")).toEqual({ ok: false, error: "Slack isn't connected to this app" });
    expect(methods()).toEqual([]);
    expect(state.writes).toEqual([]);
  });

  it("control: asks in the reporter's thread, in the company's own workspace", async () => {
    setTables({ issues: [issue("i-a", A, [slackSource("s-a", A, A_INBOX)])] });
    expect(await askFollowups("i-a", "u1")).toEqual({ ok: true, asked: ["Alex"] });
    expect(h.calls).toEqual([expect.objectContaining({ token: "xoxb-A", args: expect.objectContaining({ channel: A_INBOX, thread_ts: "1.1", text: expect.stringContaining("Which screen were you on?") }) })]);
  });
});

describe("events are routed by workspace", () => {
  const asked = (source: string) => ({ dedupe_key: `followup:i-x:${source}` });
  const message = (team: string, channel: string, extra: Record<string, unknown> = {}) =>
    ({ team_id: team, event: { type: "message", channel, user: "U1", text: "It was the pickup screen", ts: "10.1", ...extra } });

  it("a message in a company's inbox is filed into that company's app", async () => {
    setTables({});
    h.ingest.mockResolvedValue({ id: "s-new", duplicate: false });
    await handleEvent(message("TA", A_INBOX));
    expect(h.ingest).toHaveBeenCalledWith(expect.objectContaining({ projectId: A, channel: A_INBOX, via: "inbox" }));
  });

  it("an event from one workspace naming another company's channel is ignored", async () => {
    setTables({});
    await handleEvent(message("TA", B_INBOX));
    await handleEvent(message("TB", A_INBOX));
    expect(h.ingest).not.toHaveBeenCalled();
    expect(methods()).toEqual([]);
  });

  it("an event from a workspace no company has connected does nothing", async () => {
    setTables({});
    await handleEvent(message("TSTRANGER", A_INBOX));
    await handleEvent({ event: { type: "message", channel: A_INBOX, user: "U1", text: "hi", ts: "1.0" } });
    expect(h.ingest).not.toHaveBeenCalled();
  });

  it("the legacy workspace reaches only the demo app", async () => {
    setTables({});
    h.ingest.mockResolvedValue({ id: "s-new", duplicate: false });
    await handleEvent(message("TLEGACY", A_INBOX));
    expect(h.ingest).not.toHaveBeenCalled();
    await handleEvent(message("TLEGACY", DEMO_INBOX));
    expect(h.ingest).toHaveBeenCalledWith(expect.objectContaining({ projectId: DEMO }));
  });

  it("a thread reply is a follow-up answer only for the app whose inbox it is in", async () => {
    setTables({ sources: [slackSource("s-b", B, A_INBOX, "9.9")], alert_log: [asked("s-b")] });
    expect(await followupSourceFor(A, A_INBOX, "9.9")).toBeNull();
    await handleEvent(message("TA", A_INBOX, { thread_ts: "9.9" }));
    expect(h.ingest).not.toHaveBeenCalled();
    expect(state.writes).toEqual([]);
  });

  it("control: a reply where the app asked is filed as its answer", async () => {
    setTables({ sources: [slackSource("s-a", A, A_INBOX, "9.9")], alert_log: [asked("s-a")] });
    h.ingest.mockResolvedValue({ id: "s-answer", duplicate: false });
    expect(await followupSourceFor(A, A_INBOX, "9.9")).toBe("s-a");
    await handleEvent(message("TA", A_INBOX, { thread_ts: "9.9" }));
    expect(h.ingest).toHaveBeenCalledWith(expect.objectContaining({ projectId: A, via: "reply", threadTs: "9.9" }));
  });
});

describe("uninstalling", () => {
  it("app_uninstalled revokes that workspace's installation and forgets its token, and nobody else's", async () => {
    setTables({});
    await handleEvent({ team_id: "TA", event: { type: "app_uninstalled" } });
    expect(state.writes).toContainEqual(expect.objectContaining({ table: "slack_installations", op: "update", values: expect.objectContaining({ status: "revoked" }) }));
    expect(h.dropped).toEqual(["conn-a"]);
    expect(h.marked).toEqual([["conn-a", "revoked"]]);
  });

  it("tokens_revoked only counts when it names this installation's bot", async () => {
    setTables({});
    await handleEvent({ team_id: "TA", event: { type: "tokens_revoked", tokens: { oauth: ["U1"], bot: ["USOMEONEELSE"] } } });
    expect(h.dropped).toEqual([]);
    await handleEvent({ team_id: "TA", event: { type: "tokens_revoked", tokens: { bot: ["UBOTA"] } } });
    expect(h.dropped).toEqual(["conn-a"]);
  });
});

describe("the filed note in an inbox thread", () => {
  it("is never posted for an app without Slack", async () => {
    setTables({ sources: [slackSource("s-c", NOSLACK, "CNOSLACK", "5.5")] });
    await slackOnFiled("s-c", []);
    expect(h.posts).toEqual([]);
  });

  it("is never posted when the source names a channel that isn't the app's inbox", async () => {
    setTables({ sources: [slackSource("s-a", A, B_INBOX, "5.5")] });
    await slackOnFiled("s-a", []);
    expect(h.posts).toEqual([]);
  });

  it("control: is posted in the app's own inbox thread with its company's token", async () => {
    setTables({ sources: [slackSource("s-a", A, A_INBOX, "5.5")] });
    await slackOnFiled("s-a", []);
    expect(h.posts).toEqual([{ channel: A_INBOX, thread: "5.5", token: "xoxb-A" }]);
  });
});

describe("alert DMs", () => {
  const blocking = { prev: null, next: 80, type: "bug" as const, severity: 5, clarity: 4, reason: "blocks pickup", wasBlocking: false, signals: { blocks_task: 1, has_workaround: 0, data_loss: 0, frequency_words: 0, of: 1 } };

  it("are not sent for an app without Slack, but the alert is still logged on the issue", async () => {
    setTables({ issues: [issue("i-c", NOSLACK, [])], activity: [], alert_log: [] });
    await alertsAfterScore("i-c", blocking);
    expect(methods()).toEqual([]);
    expect(state.writes.find((w) => w.table === "activity")?.values).toMatchObject({ issue_id: "i-c", kind: "alert", payload: { rule: "blocking_bug", sent_to: [] } });
  });

  it("control: are sent in the company's own workspace", async () => {
    setTables({ issues: [issue("i-b", B, [])], activity: [], alert_log: [] });
    await alertsAfterScore("i-b", blocking);
    expect(methods()).toEqual(["users.lookupByEmail", "chat.postMessage"]);
    expect(tokens()).toEqual(["xoxb-B"]);
  });
});
