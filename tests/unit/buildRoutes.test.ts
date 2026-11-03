// The routes after an approval: Link pull request (POST/PATCH/DELETE /api/issues/[id]/pull-requests), Mark as shipped
// (POST /api/issues/[id]/ship), the hand-off record (POST /api/issues/[id]/handoff), the build choice on approve, and
// the app's build default (PUT /api/apps/[appId]/build). Outsiders get a 404, people without the role a 403, and
// nothing is written before those checks; the demo app keeps its own path. The database is an in-memory stand-in.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type Ctx = { role: "owner" | "admin" | "member"; userId: string; org?: { id: string }; project: { id: string; kind: string; repo_full_name: string | null; watched_branch?: string | null } };
const h = vi.hoisted(() => ({
  ctx: null as null | Ctx,
  tables: {} as Record<string, Row[]>,
  writes: [] as { table: string; op: string; values?: unknown }[],
  told: [] as string[],
  synced: [] as string[],
  approve: vi.fn(),
  /** A write that fails: { table, op }. */
  failOn: null as null | { table: string; op: string },
  /** Runs just before an update applies (to change a row under it, as a concurrent request would). */
  onUpdate: null as null | ((table: string) => void),
}));

/** Column defaults the database fills in (migration 0040). */
const DEFAULTS: Record<string, Row> = { pull_request_links: { state: "open", preview_url: null } };

/** A small Supabase stand-in over h.tables: eq/in/gte filters, inserts that return their row, updates and deletes that apply. */
function db() {
  return {
    from(table: string) {
      let op: "select" | "insert" | "update" | "delete" = "select";
      let values: Row | null = null;
      const filters: ((r: Row) => boolean)[] = [];
      const rows = () => (h.tables[table] ??= []);
      const run = (one: "single" | "maybe" | null) => {
        if (h.failOn && h.failOn.table === table && h.failOn.op === op) { h.writes.push({ table, op: `${op} (failed)` }); return { data: null, error: { message: "boom", code: "XX000" } }; }
        if (op === "update") h.onUpdate?.(table);
        if (op === "insert") {
          const now = new Date().toISOString();
          const row = { id: `${table}-${rows().length + 1}`, created_at: now, ...(table === "activity" ? { at: now } : {}), ...(DEFAULTS[table] ?? {}), ...values };
          rows().push(row); h.writes.push({ table, op, values });
          return { data: one ? row : [row], error: null };
        }
        const hit = rows().filter((r) => filters.every((f) => f(r)));
        if (op === "update") { hit.forEach((r) => Object.assign(r, values)); h.writes.push({ table, op, values }); return { data: hit, error: null }; }
        if (op === "delete") { h.tables[table] = rows().filter((r) => !hit.includes(r)); h.writes.push({ table, op }); return { data: hit, error: null }; }
        // Reads hand back copies, as a real database does.
        const copies = hit.map((r) => ({ ...r }));
        if (one === "single") return copies.length === 1 ? { data: copies[0], error: null } : { data: null, error: { message: "rows" } };
        if (one === "maybe") return { data: copies[0] ?? null, error: null };
        return { data: copies, error: null };
      };
      const q: Record<string, unknown> = {
        select: () => q, order: () => q, limit: () => q,
        insert: (v: Row) => { op = "insert"; values = v; return q; },
        update: (v: Row) => { op = "update"; values = v; return q; },
        delete: () => { op = "delete"; return q; },
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
        in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q; },
        gte: (c: string, v: string) => { filters.push((r) => String(r[c]) >= v); return q; },
        single: async () => run("single"),
        maybeSingle: async () => run("maybe"),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run(null)).then(res, rej),
      };
      return q;
    },
  };
}

vi.mock("@/lib/db/app", () => ({
  appForIssue: async () => h.ctx,
  appById: async () => h.ctx,
  hasRole: (ctx: { role: string }, roles: string[]) => roles.includes(ctx.role),
}));
vi.mock("@/lib/db/server", () => ({ serviceDb: () => db(), userDb: async () => db() }));
vi.mock("@/lib/slack/hooks", () => ({ slackSyncLater: (id: string) => { h.synced.push(id); } }));
vi.mock("@/lib/slack/reporters", () => ({ tellReporters: async (id: string) => { h.told.push(id); } }));
vi.mock("@/lib/actions/approve", () => ({ approveAndMerge: (...a: unknown[]) => h.approve(...a) }));

import { POST as linkPr } from "@/app/api/issues/[id]/pull-requests/route";
import { PATCH as patchPr, DELETE as deletePr } from "@/app/api/issues/[id]/pull-requests/[linkId]/route";
import { POST as ship } from "@/app/api/issues/[id]/ship/route";
import { POST as handedOff } from "@/app/api/issues/[id]/handoff/route";
import { POST as approve } from "@/app/api/issues/[id]/approve/route";
import { PUT as putBuild } from "@/app/api/apps/[appId]/build/route";
import { LINK_AFTER_APPROVAL, LINK_DISMISSED, LINK_SHIPPED, notReadyToLink } from "@/lib/api/prLinks";
import { BUILD_UNAVAILABLE, LINK_FORBIDDEN, PR_ALREADY_LINKED, PR_URL_INVALID, PREVIEW_INVALID, prWrongRepo, SHIP_FORBIDDEN, SHIP_NEEDS_PR, SHIP_NOT_READY } from "@/lib/handoff/build";

const ISSUE = "11111111-1111-4111-8111-111111111111";
const APP = "e5123994-2425-4415-8d88-105b998592b2";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const p = { params: Promise.resolve({ id: ISSUE }) };
const link = (body: unknown) => linkPr(new Request("http://x", json(body)), p);
const PR = "https://github.com/acme/web-app/pull/42";

beforeEach(() => {
  h.ctx = { role: "owner", userId: ME, org: { id: "org-1" }, project: { id: APP, kind: "customer", repo_full_name: "acme/web-app", watched_branch: "main" } };
  h.tables = {
    issues: [{ id: ISSUE, status: "ready_to_build", owner_id: null, project_id: APP, projects: { kind: "customer" } }],
    pull_request_links: [], activity: [], projects: [{ id: APP, settings: { other: true } }],
  };
  h.writes = []; h.told = []; h.synced = []; h.failOn = null; h.onUpdate = null;
  h.approve.mockReset().mockResolvedValue({ ok: true });
});

describe("Link pull request", () => {
  it("someone outside the company gets a 404 and a member a 403, before anything is written", async () => {
    h.ctx = null;
    expect((await link({ url: PR })).status).toBe(404);
    h.ctx = { role: "member", userId: ME, org: { id: "org-1" }, project: { id: APP, kind: "customer", repo_full_name: "acme/web-app" } };
    const res = await link({ url: PR });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(LINK_FORBIDDEN);
    expect(h.writes).toEqual([]);
  });

  it("the issue's owner may link it even as a member", async () => {
    h.ctx = { role: "member", userId: ME, org: { id: "org-1" }, project: { id: APP, kind: "customer", repo_full_name: "acme/web-app" } };
    h.tables.issues[0].owner_id = ME;
    expect((await link({ url: PR })).status).toBe(200);
  });

  it("stores a pull request in the app's repository in one shape, with its preview, and notes it in the activity", async () => {
    const res = await link({ url: "https://github.com/ACME/web-app/pull/42/files", preview: "https://web-app-git-fix.vercel.app" });
    expect(res.status).toBe(200);
    expect(h.tables.pull_request_links).toEqual([expect.objectContaining({ issue_id: ISSUE, url: PR, repo: "acme/web-app", number: 42, preview_url: "https://web-app-git-fix.vercel.app/", linked_by: ME })]);
    expect(h.tables.activity).toEqual([expect.objectContaining({ kind: "pr_linked", user_id: ME, payload: expect.objectContaining({ pr_url: PR, pr_number: 42 }) })]);
  });

  it("refuses a link that isn't a pull request, one in another repository, a bad preview, and the same pull request twice", async () => {
    const answer = async (body: unknown) => { const r = await link(body); return { status: r.status, ...(await r.json()) }; };
    expect(await answer({ url: "https://github.com/acme/web-app/issues/3" })).toMatchObject({ status: 400, error: PR_URL_INVALID, field: "url" });
    expect(await answer({ url: "https://github.com/evil/web-app/pull/3" })).toMatchObject({ status: 400, error: prWrongRepo("acme/web-app"), field: "url" });
    expect(await answer({ url: PR, preview: "http://insecure.example" })).toMatchObject({ status: 400, error: PREVIEW_INVALID, field: "preview" });
    expect(h.tables.pull_request_links).toEqual([]);
    expect((await link({ url: PR })).status).toBe(200);
    expect(await answer({ url: `${PR}/commits` })).toMatchObject({ status: 409, error: PR_ALREADY_LINKED });
    expect(h.tables.pull_request_links).toHaveLength(1);
  });

  it("only while the issue is Ready to build: not before the approval (that skips the hand-off), not once shipped", async () => {
    for (const [status, error] of [["draft_ready", LINK_AFTER_APPROVAL], ["new", LINK_AFTER_APPROVAL], ["dismissed", LINK_DISMISSED], ["shipped", LINK_SHIPPED]] as const) {
      h.tables.issues[0].status = status;
      const res = await link({ url: PR });
      expect(res.status, status).toBe(409);
      expect((await res.json()).error).toBe(error);
    }
    expect(h.writes).toEqual([]);
  });

  it("says what is wrong for each status that isn't Ready to build: dismissed as it always has, shipped, and the rest to approve first", async () => {
    const say = async (status: string) => {
      const res = notReadyToLink({ id: ISSUE, status, owner_id: null });
      return res ? { status: res.status, error: (await res.json()).error } : null;
    };
    expect(LINK_DISMISSED).toBe("This issue was dismissed.");
    expect(await say("dismissed")).toEqual({ status: 409, error: "This issue was dismissed." });
    expect(await say("shipped")).toEqual({ status: 409, error: LINK_SHIPPED });
    for (const status of ["new", "drafting", "draft_ready", "in_review"]) expect(await say(status), status).toEqual({ status: 409, error: LINK_AFTER_APPROVAL });
    expect(await say("ready_to_build")).toBeNull();
  });

  it("the demo app has nothing to link", async () => {
    h.ctx!.project.kind = "demo";
    expect((await link({ url: PR })).status).toBe(409);
    expect(h.writes).toEqual([]);
  });

  it("sets and clears a preview, and removes a link pasted by mistake, but not once the issue has shipped", async () => {
    await link({ url: PR });
    // The stand-in's ids aren't UUIDs, so give the link one.
    const uuid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    h.tables.pull_request_links[0].id = uuid;
    const lp = { params: Promise.resolve({ id: ISSUE, linkId: uuid }) };
    const patch = (preview: unknown) => patchPr(new Request("http://x", { ...json({ preview }), method: "PATCH" }), lp);
    expect((await patch("https://x.netlify.app")).status).toBe(200);
    expect(h.tables.pull_request_links[0].preview_url).toBe("https://x.netlify.app/");
    expect((await patch("ftp://x")).status).toBe(400);
    expect((await patch("")).status).toBe(200);
    expect(h.tables.pull_request_links[0].preview_url).toBeNull();
    expect(h.tables.activity.map((a) => a.kind)).toEqual(["pr_linked", "preview_added", "preview_removed"]);

    // Editing and removing follow the same window as linking.
    for (const status of ["shipped", "draft_ready"]) {
      h.tables.issues[0].status = status;
      expect((await patch("https://y.netlify.app")).status, status).toBe(409);
      expect((await deletePr(new Request("http://x", { method: "DELETE" }), lp)).status, status).toBe(409);
    }
    expect(h.tables.pull_request_links[0].preview_url).toBeNull();
    h.tables.issues[0].status = "ready_to_build";
    h.ctx!.role = "member";
    expect((await deletePr(new Request("http://x", { method: "DELETE" }), lp)).status).toBe(403);
    h.ctx!.role = "admin";
    expect((await deletePr(new Request("http://x", { method: "DELETE" }), lp)).status).toBe(200);
    expect(h.tables.pull_request_links).toEqual([]);
    expect((await deletePr(new Request("http://x", { method: "DELETE" }), lp)).status).toBe(404);
  });
});

describe("Mark as shipped", () => {
  const press = () => ship(new Request("http://x", { method: "POST" }), p);

  it("owners and admins only, after a pull request is linked", async () => {
    h.ctx = null;
    expect((await press()).status).toBe(404);
    h.ctx = { role: "member", userId: ME, org: { id: "org-1" }, project: { id: APP, kind: "customer", repo_full_name: "acme/web-app" } };
    const denied = await press();
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toBe(SHIP_FORBIDDEN);
    h.ctx.role = "admin";
    const early = await press();
    expect(early.status).toBe(409);
    expect((await early.json()).error).toBe(SHIP_NEEDS_PR);
    expect(h.tables.issues[0].status).toBe("ready_to_build");
    expect(h.told).toEqual([]);
  });

  it("ships through the shipped path: status, the link merged, the activity, the reporters told and the card synced", async () => {
    await link({ url: PR });
    const res = await press();
    expect(res.status).toBe(200);
    expect(h.tables.issues[0].status).toBe("shipped");
    expect(h.tables.issues[0].updated_at).toBeTruthy();
    expect(h.tables.pull_request_links[0].state).toBe("merged");
    expect(h.tables.activity.at(-1)).toMatchObject({ kind: "shipped", user_id: ME, payload: { manual: true, pr_url: PR, pr_number: 42 } });
    expect(h.told).toEqual([ISSUE]);
    expect(h.synced).toEqual([ISSUE]);
    // Pressed again: it already shipped.
    const again = await press();
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe(SHIP_NOT_READY);
    expect(h.told).toEqual([ISSUE]);
  });

  it("marks the links merged before the status flips: if that write fails, nothing has changed", async () => {
    await link({ url: PR });
    h.failOn = { table: "pull_request_links", op: "update" };
    expect((await press()).status).toBe(500);
    expect(h.tables.issues[0].status).toBe("ready_to_build");
    expect(h.tables.pull_request_links[0].state).toBe("open");
    expect(h.tables.activity.map((a) => a.kind)).toEqual(["pr_linked"]);
    expect(h.told).toEqual([]);
  });

  it("never leaves a shipped issue with open links, and puts them back when the status didn't flip", async () => {
    await link({ url: PR });
    // The status write fails: the links go back to open, so a retry starts clean.
    h.failOn = { table: "issues", op: "update" };
    expect((await press()).status).toBe(500);
    expect(h.tables.issues[0].status).toBe("ready_to_build");
    expect(h.tables.pull_request_links[0].state).toBe("open");
    // Someone moved the issue (a new mock-up) between the read and the write: nothing ships, the links go back.
    h.failOn = null;
    h.onUpdate = (table) => { if (table === "issues") h.tables.issues[0].status = "drafting"; };
    expect((await press()).status).toBe(409);
    expect(h.tables.pull_request_links[0].state).toBe("open");
    // Someone else shipped it first: their merged links stay.
    h.tables.issues[0].status = "ready_to_build";
    h.onUpdate = (table) => { if (table === "issues") h.tables.issues[0].status = "shipped"; };
    expect((await press()).status).toBe(409);
    expect(h.tables.pull_request_links[0].state).toBe("merged");
    expect(h.tables.activity.filter((a) => a.kind === "shipped")).toEqual([]);
    expect(h.told).toEqual([]);
  });

  it("if the status can't be read back after it didn't flip, the links stay merged and a retry ships it", async () => {
    await link({ url: PR });
    // Someone moved the issue under the flip, and the read that would tell us who now fails.
    h.onUpdate = (table) => { if (table === "issues") { h.tables.issues[0].status = "drafting"; h.failOn = { table: "issues", op: "select" }; } };
    const res = await press();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Couldn't mark it shipped. Try again.");
    // Not reverted: nothing is known about the issue, so the links are left alone (and a retry only needs the flip).
    expect(h.tables.pull_request_links[0].state).toBe("merged");
    expect(h.writes.filter((w) => w.table === "pull_request_links" && w.op === "update").map((w) => w.values)).toEqual([{ state: "merged" }]);
    expect(h.told).toEqual([]);
    h.onUpdate = null; h.failOn = null; h.tables.issues[0].status = "ready_to_build";
    expect((await press()).status).toBe(200);
    expect(h.tables.issues[0].status).toBe("shipped");
    expect(h.tables.pull_request_links.map((l) => l.state)).toEqual(["merged"]);
    expect(h.told).toEqual([ISSUE]);
  });

  it("logs it when the links can't be put back to open after the status didn't flip", async () => {
    await link({ url: PR });
    h.onUpdate = (table) => { if (table === "issues") { h.tables.issues[0].status = "drafting"; h.failOn = { table: "pull_request_links", op: "update" }; } };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await press();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(SHIP_NOT_READY);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("[ship]"), ISSUE, "boom");
    err.mockRestore();
    expect(h.tables.pull_request_links[0].state).toBe("merged");
    expect(h.told).toEqual([]);
  });

  it("a link added between the links merging and the status flipping is merged too: a shipped issue keeps no open link", async () => {
    await link({ url: PR });
    h.onUpdate = (table) => {
      if (table === "issues") h.tables.pull_request_links.push({ id: "late", issue_id: ISSUE, url: "https://github.com/acme/web-app/pull/43", repo: "acme/web-app", number: 43, state: "open", created_at: new Date().toISOString() });
    };
    expect((await press()).status).toBe(200);
    expect(h.tables.issues[0].status).toBe("shipped");
    expect(h.tables.pull_request_links.map((l) => [l.number, l.state])).toEqual([[42, "merged"], [43, "merged"]]);
    expect(h.told).toEqual([ISSUE]);
  });

  it("a failed sweep of late links is logged and doesn't undo the ship", async () => {
    await link({ url: PR });
    h.onUpdate = (table) => { if (table === "issues") h.failOn = { table: "pull_request_links", op: "update" }; };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await press()).status).toBe(200);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("[ship]"), ISSUE, "boom");
    err.mockRestore();
    expect(h.tables.issues[0].status).toBe("shipped");
    expect(h.tables.activity.at(-1)).toMatchObject({ kind: "shipped" });
    expect(h.told).toEqual([ISSUE]);
  });

  it("a failed activity row doesn't undo the ship: it is shipped, merged and the reporters are told", async () => {
    await link({ url: PR });
    h.failOn = { table: "activity", op: "insert" };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await press()).status).toBe(200);
    err.mockRestore();
    expect(h.tables.issues[0].status).toBe("shipped");
    expect(h.tables.pull_request_links[0].state).toBe("merged");
    expect(h.told).toEqual([ISSUE]);
  });

  it("only from Ready to build, and never on the demo app", async () => {
    await link({ url: PR });
    h.tables.issues[0].status = "draft_ready";
    expect((await press()).status).toBe(409);
    h.tables.issues[0].status = "ready_to_build";
    (h.tables.issues[0].projects as { kind: string }).kind = "demo";
    expect((await press()).status).toBe(409);
    expect(h.tables.issues[0].status).toBe("ready_to_build");
    expect(h.told).toEqual([]);
  });
});

describe("the hand-off record", () => {
  const record = (body: unknown) => handedOff(new Request("http://x", json(body)), p);

  it("any member records it once per ten minutes; outsiders get a 404", async () => {
    h.ctx = null;
    expect((await record({ via: "copy" })).status).toBe(404);
    h.ctx = { role: "member", userId: ME, org: { id: "org-1" }, project: { id: APP, kind: "customer", repo_full_name: "acme/web-app" } };
    expect((await record({ via: "nope" })).status).toBe(400);
    expect((await record({ via: "copy", solution: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" })).status).toBe(200);
    expect((await record({ via: "download" })).status).toBe(200);
    expect(h.tables.activity).toEqual([expect.objectContaining({ kind: "handed_off", user_id: ME, payload: { via: "copy", to: "claude_code", solution_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" } })]);
  });

  it("a hand-off after an approval always registers, even minutes after one before it", async () => {
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    h.tables.activity = [
      { id: "a1", issue_id: ISSUE, kind: "handed_off", user_id: ME, at: ago(5) },
      { id: "a2", issue_id: ISSUE, kind: "approved", user_id: ME, at: ago(2), payload: { approximate: true } },
    ];
    expect((await record({ via: "copy" })).status).toBe(200);
    expect(h.tables.activity.filter((a) => a.kind === "handed_off")).toHaveLength(2);
    // A second click right after is still recorded once.
    expect(await (await record({ via: "download" })).json()).toEqual({ ok: true, repeated: true });
    expect(h.tables.activity.filter((a) => a.kind === "handed_off")).toHaveLength(2);
  });
});

describe("approve with a build choice", () => {
  const press = (body?: unknown) => approve(new Request("http://x", body === undefined ? { method: "POST" } : json(body)), p);

  it("passes the pick on, works with no body (Slack and older pages), and refuses a pick it doesn't know", async () => {
    expect((await press({ build: "claude_code" })).status).toBe(200);
    // The pick, the branch (for Add to an existing branch) and this deployment's origin (for Build it's run).
    expect(h.approve).toHaveBeenLastCalledWith(ISSUE, ME, { build: "claude_code", branch: null, origin: "http://x" });
    expect((await press()).status).toBe(200);
    expect(h.approve).toHaveBeenLastCalledWith(ISSUE, ME, { branch: null, origin: "http://x" });
    h.approve.mockClear();
    expect((await press({ build: "yolo" })).status).toBe(400);
    expect(h.approve).not.toHaveBeenCalled();
  });
});

describe("the app's build default", () => {
  const put = (body: unknown) => putBuild(new Request("http://x", { ...json(body), method: "PUT" }), { params: Promise.resolve({ appId: APP }) });

  it("owners and admins save Claude Code, keeping the other settings", async () => {
    const res = await put({ mode: "claude_code" });
    expect(res.status).toBe(200);
    expect(h.tables.projects[0].settings).toEqual({ other: true, build: { mode: "claude_code" } });
  });

  it("refuses outsiders, members, the demo, unknown picks and ways PMA can't build yet", async () => {
    h.ctx = null;
    expect((await put({ mode: "claude_code" })).status).toBe(404);
    h.ctx = { role: "member", userId: ME, org: { id: "org-1" }, project: { id: APP, kind: "customer", repo_full_name: null } };
    expect((await put({ mode: "claude_code" })).status).toBe(403);
    h.ctx.role = "owner";
    const pr = await put({ mode: "new_pr" });
    expect(pr.status).toBe(409);
    expect((await pr.json()).error).toBe(BUILD_UNAVAILABLE);
    expect((await put({ mode: "anything" })).status).toBe(400);
    h.ctx.project.kind = "demo";
    expect((await put({ mode: "claude_code" })).status).toBe(400);
    expect(h.writes).toEqual([]);
  });
});
