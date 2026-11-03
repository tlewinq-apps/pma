// Retry on an approximate mock-up whose run was killed (I3): after MOCKUP_STALE_MS the panel offers Retry, and the
// retry must start even though the dead draft is still `dispatched` inside the 45-minute window that holds a GitHub draft.
// The demo app and a young drawing keep the old rule: a draft in flight blocks a second one.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "./fakeDb";

const h = vi.hoisted(() => ({ inProgress: true, started: [] as string[] }));
vi.mock("@/lib/github/dispatch", () => ({ hasDraftInProgress: async () => h.inProgress }));
vi.mock("@/lib/actions/solveAndDraft", () => ({ draftSolution: async (_issue: string, solution: string) => { h.started.push(solution); return true; } }));
vi.mock("@/lib/db/server", () => ({ serviceDb: () => { throw new Error("not used"); } }));

import { startDraft } from "@/lib/actions/drafting";
import type { SupabaseClient } from "@supabase/supabase-js";

const ISSUE = "11111111-1111-4111-8111-111111111111";
const at = "2026-10-16T09:00:00.000Z";
const diagnosis = {
  status: "done", started_at: at, finished_at: at, steps: [], simulated: false,
  finding: { headline: "The look is cut off.", facts: [], evidence: [], logging_added: [], where: "Result popup", confidence: "likely", code_refs: [{ path: "src/a.tsx", line: 3, note: "fixed height" }], source: { repo: "acme/Closet", ref: "main", read: true } },
};
const tables = (kind: string, minutesAgo: number) => ({
  solutions: [{ id: "s1", issue_id: ISSUE, target_frames: [], issues: { lane: "explore", status: "drafting", type: "bug", diagnosis, projects: { kind, repo_full_name: "acme/Closet" } } }],
  drafts: [{ issue_id: ISSUE, status: "dispatched", backend: "mock", created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString() }],
});
const start = (kind: string, minutesAgo: number) => startDraft(fakeDb(tables(kind, minutesAgo)).db as unknown as SupabaseClient, ISSUE, "s1");

beforeEach(() => { h.inProgress = true; h.started = []; });

describe("retrying an approximate mock-up whose run was killed", () => {
  it("starts again after ten minutes, though the dead draft is still dispatched", async () => {
    expect(await start("customer", 11)).toEqual({ ok: true });
    expect(h.started).toEqual(["s1"]);
  });

  it("still refuses while the drawing could be running", async () => {
    expect(await start("customer", 4)).toEqual({ ok: false, status: 409, error: "draft in progress" });
    expect(h.started).toEqual([]);
  });

  it("control: the demo app keeps the 45-minute rule", async () => {
    expect(await start("demo", 11)).toEqual({ ok: false, status: 409, error: "draft in progress" });
    expect(h.started).toEqual([]);
  });
});
