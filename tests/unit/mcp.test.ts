// PMA's MCP server (POST /api/mcp, lib/mcp/server.ts), called as Claude calls it: JSON-RPC over the streamable HTTP
// route with the app's API key. A missing or wrong key is a 401 before any tool runs; every tool sees only the key's
// own app, so another company's issue is "not found"; and each tool answers in its own shape: the Desk's order for
// list_issues, the issue without emails for get_issue, the v1 feedback queue for add_feedback, and Copy task's exact
// markdown for get_build_task, which also records the hand-off. The database is the in-memory stand-in.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "./fakeDb";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  db: null as unknown,
  writes: [] as { table: string; op: string; values?: unknown }[],
  reads: [] as { table: string; filters: string[] }[],
  enqueued: [] as unknown[][],
  ran: [] as string[],
  duplicate: false,
}));

vi.mock("@/lib/db/server", () => ({ serviceDb: () => h.db, userDb: async () => h.db }));
vi.mock("@/lib/ingest/enqueue", () => ({ enqueueSource: async (...a: unknown[]) => { h.enqueued.push(a); return { id: "src-1", duplicate: h.duplicate }; } }));
vi.mock("@/lib/pipeline/deps", () => ({ runSource: async (id: string) => { h.ran.push(id); } }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => { void fn(); } }));
// Copy task's route, for the parity check: the signed-in member of the same app.
vi.mock("@/lib/db/app", () => ({ appForIssue: async () => ({ project: { repo_full_name: "acme/web", watched_branch: "main", kind: "customer" } }) }));

import { POST, GET } from "@/app/api/mcp/route";
import { GET as copyTask } from "@/app/api/issues/[id]/handoff/route";
import { EVIDENCE_NOTE, LIST_LIMIT, MCP_TOOLS } from "@/lib/mcp/server";
import { HANDOFF_PREFACE, SAID_FRAMING } from "@/lib/handoff/task";

process.env.APP_URL = "https://pma.test";
const DAY = 86_400_000;
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const ACME = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER = "bbbbbbbb-0000-4000-8000-000000000002";
const PAY = "11111111-1111-4111-8111-111111111111";
const THEIRS = "99999999-9999-4999-8999-999999999999";

const projects: Row[] = [
  { id: ACME, api_key: "key-acme", slug: "web", name: "Acme Web", kind: "customer", repo_full_name: "acme/web", watched_branch: "main", organizations: { slug: "acme" } },
  { id: OTHER, api_key: "key-other", slug: "app", name: "Other App", kind: "customer", repo_full_name: "other/app", watched_branch: "main", organizations: { slug: "other" } },
];
const embeddedProject = (name: string, repo: string) => ({ repo_full_name: repo, design_path: "design", score_weights: null, kind: "customer", product_profile: null, name, settings: {} });
const unit = (quote: string, o: Row = {}) => ({
  id: `u-${quote.length}`, quote, speakers: [], corroborators: [], reported_count: 0, source_id: "s-1", sentiment: -0.6, emotion: "frustrated", audience: null,
  severity_signals: null, created_at: iso(-1), sources: { author: "Sam", channel: "Intercom", occurred_at: iso(-1), kind: "paste", metadata: null }, ...o,
});
const issue = (o: Row & { id: string; short_id: string }): Row => ({
  project_id: ACME, title: "An issue", problem_statement: "Something is wrong.", type: "bug", lane: "backlog", status: "new", importance: 3, ease: 3,
  people_count: 1, decision: null, score_breakdown: { severity: 2 }, owner_id: null, followups: null, diagnosis: null, updated_at: iso(-2),
  projects: embeddedProject("Acme Web", "acme/web"), jobs: null, feedback_units: [], issue_screens: [], solutions: [], drafts: [], activity: [],
  pull_request_links: [], builds: [], ...o,
});

const finding = {
  headline: "The pay button posts twice", facts: [{ label: "Seen", text: "on Safari only" }], evidence: ["Two charges in the log"], logging_added: [],
  where: "Checkout", confidence: "likely", code_refs: [{ path: "src/pay.tsx", line: 42, note: "submit has no guard" }], source: { repo: "acme/web", ref: "main", read: true },
};
const approvedPay = issue({
  id: PAY, short_id: "a1b2c3", title: "Checkout charges twice", problem_statement: "Paying twice charges the card twice. Customers notice on their statement.",
  status: "ready_to_build", importance: 9, people_count: 3, lane: "quick_win", owner_id: "u-pm", score_breakdown: { severity: 5 },
  diagnosis: { status: "done", started_at: iso(-1), steps: [], finding },
  feedback_units: [unit("It charged me twice, email me at jane@acme.test", { speakers: [], sources: { author: "jane@acme.test", channel: "Support email", occurred_at: iso(-1), kind: "paste", metadata: null } })],
  solutions: [{ id: "s1", rank: 1, title: "Guard the pay button", summary: "Disable the button while paying. It stays disabled until the answer comes back.", tradeoffs: null, effort: "S", risk: "low", recommended: true, mode: "approximate", target_frames: [], origin: "ai", edited_by: null, edited_at: null, original: null }],
  drafts: [{ id: "d1", status: "ready", solution_id: "s1", demo: false, backend: "approximate", pr_url: null, pr_number: null, pr_state: null, branch: null, before_images: [], after_images: [], marver_paths: [], log_url: null, created_at: iso(-1), frames: [{ frame_id: "f1", path: "", changed: "The Pay button shows a spinner and can't be pressed twice" }], flow: null }],
  activity: [{ id: 1, kind: "approved", user_id: "u-pm", payload: { approximate: true, build: "claude_code" }, at: iso(-0.5) }],
});
const issues: Row[] = [
  approvedPay,
  issue({ id: "22222222-2222-4222-8222-222222222222", short_id: "d4e5f6", title: "Dark mode", type: "new_feature", importance: 8 }),
  issue({ id: "33333333-3333-4333-8333-333333333333", short_id: "0a0b0c", title: "Typo on Settings", importance: 2, score_breakdown: { severity: 1 } }),
  issue({ id: "44444444-4444-4444-8444-444444444444", short_id: "5h1pp3", title: "Shipped already", status: "shipped" }),
  issue({ id: "55555555-5555-4555-8555-555555555555", short_id: "d15m15", title: "Dismissed", status: "dismissed" }),
  issue({ id: THEIRS, short_id: "7e1a75", project_id: OTHER, title: "Their secret roadmap", status: "ready_to_build", projects: embeddedProject("Other App", "other/app"),
    solutions: approvedPay.solutions, drafts: approvedPay.drafts, activity: approvedPay.activity }),
];

beforeEach(() => {
  const f = fakeDb({ projects, issues, screens: [], activity: [] }, {
    service_member_emails: [{ user_id: "u-pm", email: "pm@acme.test" }], project_member_emails: [{ user_id: "u-pm", email: "pm@acme.test" }],
  });
  h.db = f.db; h.writes = f.writes; h.reads = f.reads;
  h.enqueued = []; h.ran = []; h.duplicate = false;
});

const post = (body: unknown, auth: string | null = "Bearer key-acme") => POST(new Request("https://pma.test/api/mcp", {
  method: "POST", body: JSON.stringify(body),
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(auth ? { authorization: auth } : {}) },
}));
const rpc = async (method: string, params?: unknown, auth?: string | null) => {
  const res = await post({ jsonrpc: "2.0", id: 1, method, params }, auth);
  return { status: res.status, body: await res.json() };
};
type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };
const call = async (name: string, args: Row = {}, auth?: string): Promise<ToolResult> => (await rpc("tools/call", { name, arguments: args }, auth)).body.result;
const jsonOf = (r: ToolResult) => JSON.parse(r.content[0].text);

describe("auth", () => {
  it("answers 401 without a key, with a malformed header or with a key no app has, before any tool runs", async () => {
    for (const auth of [null, "", "Basic key-acme", "Bearer ", "Bearer nope"]) {
      const res = await post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_issues", arguments: {} } }, auth);
      expect(res.status, String(auth)).toBe(401);
      expect(res.headers.get("www-authenticate"), String(auth)).toMatch(/^Bearer/);
    }
    // Only the key lookup ran: no issue was read.
    expect(h.reads.filter((r) => r.table !== "projects")).toEqual([]);
    expect(h.enqueued).toEqual([]);
  });

  it("is stateless: GET and DELETE have nothing to serve", async () => {
    expect((await GET()).status).toBe(405);
  });
});

describe("the server", () => {
  it("introduces itself with instructions that frame feedback as evidence, and lists exactly its four tools", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe("pma");
    expect(init.body.result.instructions).toContain(EVIDENCE_NOTE);
    expect(init.body.result.instructions).toContain("Acme Web");
    const list = await rpc("tools/list");
    const tools = list.body.result.tools as { name: string; description: string; inputSchema: { properties?: Row } }[];
    expect(tools.map((t) => t.name)).toEqual([...MCP_TOOLS]);
    for (const t of tools) expect(t.description.length, t.name).toBeGreaterThan(80);
    expect(Object.keys(tools[0].inputSchema.properties ?? {})).toEqual(["type", "limit"]);
  });
});

describe("list_issues", () => {
  it("lists the app's open issues in the Desk's order (Urgent, then bugs, then features), with no emails", async () => {
    const r = await call("list_issues");
    expect(r.isError).toBeFalsy();
    const out = jsonOf(r);
    expect(out).toMatchObject({ app: "Acme Web", open: 3, shown: 3, note: EVIDENCE_NOTE });
    expect(out.issues.map((i: Row) => [i.short_id, i.rail])).toEqual([["a1b2c3", "Urgent"], ["0a0b0c", "Bugs"], ["d4e5f6", "New features"]]);
    expect(Object.keys(out.issues[0]).sort()).toEqual(["assigned", "impact", "lane", "people", "priority", "proposal", "rail", "short_id", "stage", "title", "type", "urgency", "url"]);
    expect(out.issues[0]).toMatchObject({
      title: "Checkout charges twice", type: "bug", stage: "Ready to build", impact: "Blocker", people: 3, priority: 9, lane: "Quick win",
      proposal: "Guard the pay button", assigned: true, url: `https://pma.test/acme/web/issues/${PAY}`,
    });
    expect(out.issues[0].urgency).toBeGreaterThanOrEqual(9);
    expect(r.content[0].text).not.toMatch(/@acme\.test/);
  });

  it("filters by type and stops at the limit", async () => {
    expect(jsonOf(await call("list_issues", { type: "new_feature" })).issues.map((i: Row) => i.short_id)).toEqual(["d4e5f6"]);
    const one = jsonOf(await call("list_issues", { limit: 1 }));
    expect(one).toMatchObject({ open: 3, shown: 1 });
    expect((await call("list_issues", { limit: LIST_LIMIT.max + 1 })).isError).toBe(true);
    expect((await call("list_issues", { type: "epic" })).isError).toBe(true);
  });

  it("never shows another company's issues", async () => {
    const text = (await call("list_issues")).content[0].text;
    expect(text).not.toContain("Their secret roadmap");
    expect(jsonOf(await call("list_issues", {}, "Bearer key-other")).issues.map((i: Row) => i.short_id)).toEqual(["7e1a75"]);
  });
});

describe("get_issue", () => {
  it("returns the problem, quotes without emails, the finding with file:line evidence, proposals and the approved mock-up", async () => {
    const r = await call("get_issue", { issue: "a1b2c3" });
    expect(r.isError).toBeFalsy();
    const out = jsonOf(r);
    expect(out).toMatchObject({
      note: EVIDENCE_NOTE, short_id: "a1b2c3", title: "Checkout charges twice", type: "bug", stage: "Ready to build", impact: "Blocker",
      problem: "Paying twice charges the card twice. Customers notice on their statement.", quotes_total: 1,
      finding: { step: "Diagnose", state: "done", headline: "The pay button posts twice", code: [{ at: "src/pay.tsx:42", note: "submit has no guard", url: "https://github.com/acme/web/blob/main/src/pay.tsx#L42" }] },
      proposals: [{ title: "Guard the pay button", recommended: true, mocked_up: true }],
      mockup: { status: "approved", proposal: "Guard the pay button", changed: ["The Pay button shows a spinner and can't be pressed twice"] },
      build: { next: "Approved and waiting to be built. get_build_task hands it to Claude Code.", pull_requests: [] },
    });
    expect(out.quotes[0]).toEqual({ quote: "It charged me twice, email me at (email removed)", who: "(email removed)", channel: "Support email", at: expect.any(String) });
    expect(r.content[0].text).not.toMatch(/@acme\.test/);
  });

  it("finds an issue by its PMA line, its id or a link to its page", async () => {
    for (const ref of ["PMA: a1b2c3", "A1B2C3", PAY, `https://pma.test/acme/web/issues/${PAY}`]) expect(jsonOf(await call("get_issue", { issue: ref })).short_id, ref).toBe("a1b2c3");
  });

  it("says not found for another company's issue, by short id, id or link, as for one that doesn't exist", async () => {
    for (const ref of ["7e1a75", THEIRS, `https://pma.test/other/app/issues/${THEIRS}`, "zzzzzz", "%", "a_b2c3"]) {
      const r = await call("get_issue", { issue: ref });
      expect(r.isError, ref).toBe(true);
      expect(r.content[0].text, ref).toMatch(/^No issue ".*" in this app\./);
      expect(r.content[0].text, ref).not.toContain("Their secret roadmap");
    }
  });
});

describe("add_feedback", () => {
  it("queues the text as POST /api/v1/feedback does, then runs the pipeline", async () => {
    const out = jsonOf(await call("add_feedback", { text: "  The export button is hidden on mobile ", author: "Dana", occurred_at: "2026-10-30T10:00:00Z" }));
    expect(out).toMatchObject({ queued: true, duplicate: false, url: "https://pma.test/acme/web/feedback/src-1" });
    expect(h.enqueued).toEqual([[ACME, { kind: "paste", raw_text: "The export button is hidden on mobile", author: "Dana", channel: "Claude", occurred_at: "2026-10-30T10:00:00.000Z", route: null }]]);
    expect(h.ran).toEqual(["src-1"]);
  });

  it("says when PMA already has it, and refuses blank text or a bad date without queuing", async () => {
    h.duplicate = true;
    expect(jsonOf(await call("add_feedback", { text: "Same again", channel: "Sales call" }))).toMatchObject({ queued: false, duplicate: true });
    expect(h.ran).toEqual([]);
    h.enqueued = [];
    expect(await call("add_feedback", { text: "   " })).toMatchObject({ isError: true, content: [{ text: "text required" }] });
    expect(await call("add_feedback", { text: "x", occurred_at: "yesterday" })).toMatchObject({ isError: true, content: [{ text: "occurred_at must be an ISO date" }] });
    expect(h.enqueued).toEqual([]);
  });

  it("files feedback under the key's own app", async () => {
    await call("add_feedback", { text: "Theirs" }, "Bearer key-other");
    expect(h.enqueued[0][0]).toBe(OTHER);
  });
});

describe("get_build_task", () => {
  it("is Copy task's exact markdown, ending with the PMA line, and records the hand-off once", async () => {
    const r = await call("get_build_task", { issue: "a1b2c3" });
    expect(r.isError).toBeFalsy();
    const md = r.content[0].text;
    const copied = await (await copyTask(new Request(`https://pma.test/api/issues/${PAY}/handoff`), { params: Promise.resolve({ id: PAY }) })).text();
    expect(md).toBe(copied);
    expect(md.trimEnd().split("\n").at(-1)).toBe("PMA: a1b2c3");
    expect(md).toContain(HANDOFF_PREFACE);
    expect(md).toContain(SAID_FRAMING);
    expect(md).toMatch(/- `src\/pay\.tsx`: line 42, /);
    expect(md).not.toMatch(/@acme\.test/);
    expect(h.writes).toEqual([{ table: "activity", op: "insert", values: { issue_id: PAY, user_id: null, kind: "handed_off", payload: { via: "mcp", to: "claude_code", solution_id: "s1" } } }]);
  });

  it("doesn't record the hand-off again when the task was pulled in the last ten minutes", async () => {
    const f = fakeDb({ projects, issues, screens: [], activity: [{ id: 9, issue_id: PAY, kind: "handed_off", user_id: null, payload: { via: "mcp" }, at: iso(-1 / 24 / 60) }] }, { service_member_emails: [] });
    h.db = f.db;
    expect((await call("get_build_task", { issue: "a1b2c3" })).isError).toBeFalsy();
    expect(f.writes).toEqual([]);
  });

  it("refuses an issue that isn't approved yet, or has shipped, with where it stands", async () => {
    const early = await call("get_build_task", { issue: "d4e5f6" });
    expect(early.isError).toBe(true);
    expect(early.content[0].text).toMatch(/^"Dark mode" \(d4e5f6\) isn't approved yet \(Needs scoping\)\. .*https:\/\/pma\.test\/acme\/web\/issues\//);
    expect((await call("get_build_task", { issue: "5h1pp3" })).content[0].text).toMatch(/has shipped already/);
    expect(h.writes).toEqual([]);
  });

  it("says not found for another company's approved issue, and records nothing", async () => {
    const r = await call("get_build_task", { issue: "7e1a75" });
    expect(r).toMatchObject({ isError: true });
    expect(r.content[0].text).not.toContain("Their secret roadmap");
    expect(h.writes).toEqual([]);
  });
});
