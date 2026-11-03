// Approving a mock-up (spec call 11). A customer app's approximate mock-up, drawn from its code with no pull request
// behind it, is approved, not shipped: the issue becomes ready_to_build, the approval is in the activity, and nobody who
// raised it is told anything. The demo app keeps today's behaviour exactly: shipped, merged, and the reporters told.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  tables: {} as Record<string, unknown>,
  writes: [] as { table: string; op: "update" | "insert"; values: Record<string, unknown> }[],
  told: [] as string[],
  updateError: null as null | { message: string },
  /** The issue's status when the update runs, if another request changed it after the read (a second approval). */
  statusAtWrite: null as null | string,
  /** The status filter of each conditional update. */
  updateFilters: [] as unknown[][],
  drafted: [] as string[],
}));

vi.mock("@/lib/github/client", () => ({
  octokit: () => { throw new Error("GitHub must not be called"); },
  splitRepo: (full: string) => { const [owner, repo] = full.split("/"); return { owner, repo }; },
}));
vi.mock("@/lib/db/server", () => ({
  serviceDb: () => ({
    from: (table: string) => {
      const q = {
        select: () => q, eq: () => q, order: () => q, limit: () => q,
        single: async () => ({ data: h.tables[table] ?? null, error: null }),
        maybeSingle: async () => ({ data: h.tables[table] ?? null, error: null }),
        update: (values: Record<string, unknown>) => {
          h.writes.push({ table, op: "update", values });
          // eq() alone (the demo's updates) or eq().in().select() (the approximate approval, from a review state only).
          let allowed: unknown[] | null = null;
          const result = () => {
            const error = table === "issues" ? h.updateError : null;
            const status = h.statusAtWrite ?? (h.tables[table] as { status?: string } | undefined)?.status;
            return { error, data: error || (allowed && !allowed.includes(status)) ? [] : [{ id: "row" }] };
          };
          const chain: Record<string, unknown> = {
            eq: () => chain,
            in: (_col: string, vals: unknown[]) => { allowed = vals; h.updateFilters.push(vals); return chain; },
            select: async () => result(),
            then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
          };
          return chain;
        },
        insert: async (values: Record<string, unknown>) => { h.writes.push({ table, op: "insert", values }); return { error: null }; },
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/slack/reporters", () => ({ tellReporters: async (id: string) => { h.told.push(id); } }));
vi.mock("@/lib/actions/solveAndDraft", () => ({ draftSolution: async (id: string) => { h.drafted.push(id); return true; } }));
vi.mock("@/lib/github/dispatch", () => ({ hasDraftInProgress: async () => false }));

import { ALREADY_APPROVED, approveAndMerge, NOT_IN_REVIEW } from "@/lib/actions/approve";
import { APPROVED_NO_CHANGES, requestChanges } from "@/lib/actions/drafting";
import { BUILD_UNAVAILABLE } from "@/lib/handoff/build";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nextStep, READY_TO_BUILD } from "@/lib/nextStep";
import { stageOf } from "@/components/triage/views";
import { editLocked } from "@/lib/proposals";
import { describeActivity } from "@/lib/queries/issueHelpers";
import { projectTimeline } from "@/lib/queries/projectHelpers";

const ISSUE = "11111111-1111-4111-8111-111111111111";
const mockDraft = { id: "d1", status: "ready", demo: false, backend: "mock", pr_number: null, pr_state: "open", pr_url: "http://localhost:3000/mock/pr/d1" };
const issueOf = (kind: string | null, status = "draft_ready", settings: unknown = {}) => ({ id: ISSUE, status, lane: "explore", projects: kind === null ? null : { repo_full_name: "acme/Closet", kind, settings } });

beforeEach(() => {
  h.tables = {};
  h.writes = [];
  h.told = [];
  h.updateError = null;
  h.statusAtWrite = null;
  h.updateFilters = [];
  h.drafted = [];
});

describe("approving a customer app's approximate mock-up", () => {
  it("marks the issue ready to build, records the approval, and tells nobody", async () => {
    h.tables = { issues: issueOf("customer"), drafts: mockDraft };
    expect(await approveAndMerge(ISSUE, "u1")).toEqual({ ok: true });
    const issueUpdates = h.writes.filter((w) => w.table === "issues");
    expect(issueUpdates).toHaveLength(1);
    expect(issueUpdates[0].values.status).toBe("ready_to_build");
    expect(h.writes.some((w) => w.values.status === "shipped")).toBe(false);
    // The draft is not marked merged: there is no pull request behind it.
    expect(h.writes.filter((w) => w.table === "drafts")).toEqual([]);
    expect(h.writes.find((w) => w.table === "activity")?.values).toMatchObject({ issue_id: ISSUE, user_id: "u1", kind: "approved", payload: { mock: true, approximate: true, draft_id: "d1" } });
    expect(h.told).toEqual([]);
  });

  it("treats an app whose kind didn't load as a customer app: it never ships by mistake", async () => {
    h.tables = { issues: issueOf(null), drafts: mockDraft };
    expect(await approveAndMerge(ISSUE, "u1")).toEqual({ ok: true });
    expect(h.writes.find((w) => w.table === "issues")?.values.status).toBe("ready_to_build");
    expect(h.told).toEqual([]);
  });

  it("refuses a second approval with a sentence, and changes nothing", async () => {
    h.tables = { issues: issueOf("customer", "ready_to_build"), drafts: mockDraft };
    expect(await approveAndMerge(ISSUE, "u1")).toEqual({ ok: false, status: 409, error: ALREADY_APPROVED });
    expect(h.writes).toEqual([]);
    expect(h.told).toEqual([]);
  });

  it("only approves from a review state: a dismissed, shipped or new issue is refused and nothing changes", async () => {
    for (const status of ["dismissed", "shipped", "new", "drafting"]) {
      h.writes = [];
      h.tables = { issues: issueOf("customer", status), drafts: mockDraft };
      expect(await approveAndMerge(ISSUE, "u1")).toEqual({ ok: false, status: 409, error: NOT_IN_REVIEW });
      expect(h.writes).toEqual([]);
    }
    expect(h.told).toEqual([]);
    // In review on the page (in_review) is a review state too.
    h.tables = { issues: issueOf("customer", "in_review"), drafts: mockDraft };
    expect(await approveAndMerge(ISSUE, "u1")).toEqual({ ok: true });
  });

  it("changes the status only from a review state, so of two approvals at once only one lands", async () => {
    h.tables = { issues: issueOf("customer"), drafts: mockDraft };
    // The first approval moved it after this one read it.
    h.statusAtWrite = "ready_to_build";
    expect(await approveAndMerge(ISSUE, "u1")).toEqual({ ok: false, status: 409, error: ALREADY_APPROVED });
    expect(h.updateFilters).toEqual([["draft_ready", "in_review"]]);
    expect(h.writes.filter((w) => w.table === "activity")).toEqual([]);
    expect(h.told).toEqual([]);
  });

  it("records how it should be built: Claude Code by default, the app's saved default, never a way PMA can't build yet", async () => {
    h.tables = { issues: issueOf("customer"), drafts: mockDraft };
    expect(await approveAndMerge(ISSUE, "u1")).toEqual({ ok: true });
    expect(h.writes.find((w) => w.table === "activity")?.values.payload).toMatchObject({ approximate: true, build: "claude_code" });

    // A saved default PMA can't build yet (a pull request) falls back to Claude Code.
    h.writes = [];
    h.tables = { issues: issueOf("customer", "draft_ready", { build: { mode: "new_pr" } }), drafts: mockDraft };
    expect(await approveAndMerge(ISSUE, "u1")).toEqual({ ok: true });
    expect(h.writes.find((w) => w.table === "activity")?.values.payload).toMatchObject({ build: "claude_code" });

    // Asking for a pull request outright is refused before anything changes.
    h.writes = [];
    h.tables = { issues: issueOf("customer"), drafts: mockDraft };
    expect(await approveAndMerge(ISSUE, "u1", { build: "new_pr" })).toEqual({ ok: false, status: 409, error: BUILD_UNAVAILABLE });
    expect(await approveAndMerge(ISSUE, "u1", { build: "branch" })).toEqual({ ok: false, status: 409, error: BUILD_UNAVAILABLE });
    expect(h.writes).toEqual([]);
  });

  it("records no approval when the status couldn't be saved", async () => {
    h.tables = { issues: issueOf("customer"), drafts: mockDraft };
    h.updateError = { message: "violates check constraint" };
    expect(await approveAndMerge(ISSUE, "u1")).toEqual({ ok: false, status: 500, error: "Couldn't record the approval. Try again." });
    expect(h.writes.filter((w) => w.table === "activity")).toEqual([]);
  });
});

describe("approving on the demo app (unchanged)", () => {
  it("ships a mock-runner draft, marks it merged and tells the reporters", async () => {
    h.tables = { issues: issueOf("demo"), drafts: mockDraft };
    expect(await approveAndMerge(ISSUE, "u1")).toEqual({ ok: true });
    expect(h.writes.find((w) => w.table === "drafts")?.values).toEqual({ pr_state: "merged" });
    expect(h.writes.find((w) => w.table === "issues")?.values.status).toBe("shipped");
    expect(h.writes.find((w) => w.table === "activity")?.values.payload).toEqual({ mock: true, pr_url: mockDraft.pr_url, draft_id: "d1" });
    expect(h.told).toEqual([ISSUE]);
  });

  it("ships a demo draft the same way", async () => {
    h.tables = { issues: issueOf("demo"), drafts: { ...mockDraft, demo: true, backend: "demo" } };
    expect(await approveAndMerge(ISSUE, "u1")).toEqual({ ok: true });
    expect(h.writes.find((w) => w.table === "issues")?.values.status).toBe("shipped");
    expect(h.writes.find((w) => w.table === "activity")?.values.payload).toEqual({ demo: true, draft_id: "d1" });
    expect(h.told).toEqual([ISSUE]);
  });
});

describe("Ready to build on the page", () => {
  const base = { stage: "ready_to_build" as const, unaskedQuestions: false, slackReporters: 2, recommendedHasScreens: false, othersToTell: 3, backend: "mock", approximate: true };

  it("says to copy the task and link the pull request, and tells nobody yet", () => {
    expect(nextStep(base)).toBe("Ready to build. Copy the task for Claude Code and link the pull request.");
    expect(`${READY_TO_BUILD.lead}${READY_TO_BUILD.action}${READY_TO_BUILD.tail}`).toBe(nextStep(base));
    expect(nextStep(base)).not.toMatch(/Shipped|told|know/);
  });

  it("reviews an approximate mock-up as an approval, and the demo's as approve and ship", () => {
    expect(nextStep({ ...base, stage: "review" })).toBe("Review the mock-up: approve it, or ask for changes.");
    expect(nextStep({ ...base, stage: "review", approximate: false })).toBe("Review the mockup: approve and ship it, or ask for changes.");
    expect(nextStep({ ...base, stage: "shipped", approximate: false, othersToTell: 2 })).toBe("Shipped. Let the 2 people who raised it outside Slack know: copy a note from People who raised this.");
  });

  it("is its own stage, after review and before shipped, with the approved proposal locked", () => {
    const issue = { status: "ready_to_build" as const, draft: { status: "ready" }, proposal: { count: 2 }, type: "bug" };
    expect(stageOf(issue)).toBe("ready_to_build");
    expect(editLocked("ready_to_build", "s1", "s1")).toBe("Approved");
    expect(editLocked("ready_to_build", "s1", "s2")).toBeNull();
  });

  it("reads as an approval in the activity and on Work, never as shipped", () => {
    expect(describeActivity({ kind: "approved", payload: { mock: true, approximate: true } }).text).toBe("approved the mock-up");
    const at = "2026-10-16T12:00:00.000Z";
    const ctx = { type: "bug", solutions: [], draftSolutionId: null };
    const steps = projectTimeline([{ id: 1, kind: "approved", user_id: null, payload: { mock: true, approximate: true }, at }], new Map(), ctx);
    expect(steps[0].what).toBe("Approved the mock-up");
    const demo = projectTimeline([{ id: 2, kind: "approved", user_id: null, payload: { demo: true }, at }], new Map(), ctx);
    expect(demo[0].what).toBe("Approved and shipped");
  });
});

describe("Request changes after an approval", () => {
  const ready = { id: "d1", status: "ready", solution_id: "s1", demo: false, backend: "mock", pr_number: null, pr_state: "open" };
  const db = () => {
    const from = (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: h.tables[table] ?? null, error: null }),
      };
      return q;
    };
    return { from } as unknown as SupabaseClient;
  };

  it("refuses to re-draft an approved approximate mock-up, with a sentence, and keeps the approval", async () => {
    h.tables = { issues: issueOf("customer", "ready_to_build"), drafts: ready };
    expect(await requestChanges(db(), ISSUE, "u1", "make it bigger")).toEqual({ ok: false, status: 409, error: APPROVED_NO_CHANGES });
    expect(h.drafted).toEqual([]);
    expect(h.writes).toEqual([]);
  });

  it("refuses on a customer issue marked shipped by hand (its draft stays open)", async () => {
    h.tables = { issues: issueOf("customer", "shipped"), drafts: ready };
    expect(await requestChanges(db(), ISSUE, "u1", "make it bigger")).toEqual({ ok: false, status: 409, error: APPROVED_NO_CHANGES });
    expect(h.drafted).toEqual([]);
  });

  it("control: a mock-up still in review is re-drafted with the note", async () => {
    h.tables = { issues: issueOf("customer", "draft_ready"), drafts: ready };
    expect(await requestChanges(db(), ISSUE, "u1", "make it bigger")).toEqual({ ok: true });
    expect(h.drafted).toEqual([ISSUE]);
  });

  it("the demo's shipped issue keeps its old answer", async () => {
    h.tables = { issues: issueOf("demo", "shipped"), drafts: { ...ready, pr_state: "merged" } };
    expect(await requestChanges(db(), ISSUE, "u1", "make it bigger")).toEqual({ ok: false, status: 409, error: "There's no draft to revise" });
  });
});
