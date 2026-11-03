// Open sign-up and the Claude key: a company that set itself up (organizations.self_serve) never runs on PMA's key,
// an invited one still may during the beta, and feedback that failed for want of a key goes back in the queue once one
// is saved. The database is faked; nothing is called.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/server", () => ({ serviceDb: () => { throw new Error("pass a db"); } }));
vi.mock("@/lib/connections/store", () => ({ findConnection: async () => null, markConnection: async () => {}, readSecret: async () => null }));

import { fallbackAllowed, requeueKeylessFeedback, resolveAppClaude, SHARED_KEY_FALLBACK } from "@/lib/connections/claude";
import { NO_COMPANY_KEY } from "@/lib/llm/client";

/** A projects lookup that answers with one row, as PostgREST embeds the company: an object. */
function projectsDb(row: unknown) {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: row, error: null }) };
  return { from: () => q } as never;
}

describe("whether PMA's key may stand in", () => {
  it("never for any company: every company brings its own key", () => {
    expect(SHARED_KEY_FALLBACK).toBe(false);
    expect(fallbackAllowed({ self_serve: true })).toBe(false);
    expect(fallbackAllowed({ self_serve: false })).toBe(false);
    expect(fallbackAllowed(null)).toBe(false);
  });

  it("resolveAppClaude never lets a customer app use it; the demo may", async () => {
    expect((await resolveAppClaude("p", projectsDb({ org_id: "o", kind: "customer", organizations: { self_serve: true } }))).sharedFallback).toBe(false);
    expect((await resolveAppClaude("p", projectsDb({ org_id: "o", kind: "customer", organizations: [{ self_serve: true }] }))).sharedFallback).toBe(false);
    expect((await resolveAppClaude("p", projectsDb({ org_id: "o", kind: "customer", organizations: { self_serve: false } }))).sharedFallback).toBe(false);
    expect((await resolveAppClaude("p", projectsDb({ org_id: "o", kind: "demo", organizations: { self_serve: true } }))).sharedFallback).toBe(true);
  });
});

describe("requeueKeylessFeedback", () => {
  it("puts back only the company's sources that failed for want of a key, with their retries reset", async () => {
    const calls: { table: string; op: string; args: unknown[] }[] = [];
    const db = {
      from: (table: string) => {
        const q: Record<string, unknown> = {};
        const rec = (op: string) => (...args: unknown[]) => { calls.push({ table, op, args }); return q; };
        for (const op of ["select", "eq", "in", "update"]) q[op] = rec(op);
        q.then = (ok: (v: unknown) => unknown) => ok(table === "projects" ? { data: [{ id: "a1" }, { id: "a2" }], error: null } : { data: [{ id: "s1" }], error: null });
        return q;
      },
    } as never;
    expect(await requeueKeylessFeedback("org-1", db)).toBe(1);
    const sources = calls.filter((c) => c.table === "sources");
    expect(sources.find((c) => c.op === "update")?.args[0]).toEqual({ status: "queued", attempts: 0, error: null, locked_at: null });
    expect(sources.find((c) => c.op === "in")?.args).toEqual(["project_id", ["a1", "a2"]]);
    expect(sources.filter((c) => c.op === "eq").map((c) => c.args)).toEqual([["status", "failed"], ["error", NO_COMPANY_KEY]]);
    expect(calls.find((c) => c.table === "projects" && c.op === "eq")?.args).toEqual(["org_id", "org-1"]);
  });
});
