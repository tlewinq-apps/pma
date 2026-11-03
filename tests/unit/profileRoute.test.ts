// POST/PATCH /api/apps/[appId]/profile: draft the product profile from the repository, or save the owner's edits.
// Outsiders get a 404 and members a 403 before anything is read; the demo's profile is fixed; only then does the
// service role write product_profile. No model or repository is called for real.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APIError } from "@anthropic-ai/sdk";
import { fakeSnap } from "./fixtures/closetRepo";

type Ctx = { role: "owner" | "admin" | "member"; project: { id: string; kind: string; repo_full_name: string | null; watched_branch: string | null; product_profile?: unknown } };
const h = vi.hoisted(() => ({
  ctx: null as null | Ctx,
  updates: [] as { table: string; values: Record<string, unknown>; id: unknown }[],
  llm: vi.fn(),
  snap: null as unknown,
}));

vi.mock("@/lib/db/app", () => ({
  appById: async () => h.ctx,
  hasRole: (ctx: { role: string }, roles: string[]) => roles.includes(ctx.role),
}));
vi.mock("@/lib/db/server", () => ({
  serviceDb: () => ({
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => ({
        eq: async (_col: string, id: unknown) => { h.updates.push({ table, values, id }); return { error: null }; },
      }),
    }),
  }),
}));
vi.mock("@/lib/llm/client", () => ({
  callStructured: (...a: unknown[]) => h.llm(...a),
  withAppClaude: (_projectId: string, fn: () => unknown) => fn(),
  claudeReady: () => !!process.env.ANTHROPIC_API_KEY,
}));
vi.mock("@/lib/repo/snapshot", async (orig) => ({ ...(await orig<typeof import("@/lib/repo/snapshot")>()), openRepo: async () => h.snap }));

import { PATCH, POST } from "@/app/api/apps/[appId]/profile/route";

const APP = "e5123994-2425-4415-8d88-105b998592b2";
const params = { params: Promise.resolve({ appId: APP }) };
const post = () => POST(new Request(`http://x/api/apps/${APP}/profile`, { method: "POST" }), params);
const patch = (body: unknown) => PATCH(new Request(`http://x/api/apps/${APP}/profile`, { method: "PATCH", body: JSON.stringify(body) }), params);
const closet = { name: "Closet", one_liner: "an AI fashion app where people save clothes", audience: "shoppers", audience_one: "shopper", platform: "web and mobile" };

beforeEach(() => {
  h.ctx = { role: "owner", project: { id: APP, kind: "customer", repo_full_name: "acme/Closet.", watched_branch: "main" } };
  h.updates = [];
  h.llm.mockReset();
  h.snap = fakeSnap({ "app.json": JSON.stringify({ expo: { name: "Closet" } }) });
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
});
afterEach(() => vi.unstubAllEnvs());

describe("who may change it", () => {
  it("someone outside the company gets a 404, a member a 403, and nothing is read or written", async () => {
    h.ctx = null;
    expect((await post()).status).toBe(404);
    expect((await patch(closet)).status).toBe(404);
    h.ctx = { role: "member", project: { id: APP, kind: "customer", repo_full_name: "a/b", watched_branch: null } };
    expect((await post()).status).toBe(403);
    expect((await patch(closet)).status).toBe(403);
    expect(h.llm).not.toHaveBeenCalled();
    expect(h.updates).toEqual([]);
  });

  it("the demo's profile is fixed", async () => {
    h.ctx!.project.kind = "demo";
    expect((await patch(closet)).status).toBe(400);
    expect((await post()).status).toBe(400);
    expect(h.updates).toEqual([]);
  });
});

describe("POST: draft it from the repository", () => {
  it("drafts the profile and saves it with the service role", async () => {
    h.llm.mockResolvedValue(closet);
    const res = await post();
    expect(res.status).toBe(200);
    expect((await res.json()).profile).toEqual(closet);
    expect(h.updates).toEqual([{ table: "projects", values: { product_profile: closet }, id: APP }]);
  });

  it("asks for a repository first", async () => {
    h.ctx!.project.repo_full_name = null;
    const res = await post();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Connect your repository first/);
  });

  it("says plainly when Claude is out of credit, and saves nothing", async () => {
    h.llm.mockRejectedValue(APIError.generate(400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }, undefined, new Headers()));
    const res = await post();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("PMA's Claude account is out of credit. Ask a PMA admin to add credit, then run it again.");
    expect(h.updates).toEqual([]);
  });
});

describe("PATCH: save the owner's words", () => {
  it("saves a complete profile", async () => {
    const res = await patch({ ...closet, name: " Closet " });
    expect(res.status).toBe(200);
    expect(h.updates[0].values).toEqual({ product_profile: closet });
  });

  it("keeps the audience words drafted from the repository when the editor sends only name, one line and platform", async () => {
    h.ctx!.project.product_profile = closet;
    const res = await patch({ name: "Closet Studio", one_liner: closet.one_liner, platform: "web" });
    expect(res.status).toBe(200);
    expect(h.updates[0].values).toEqual({ product_profile: { ...closet, name: "Closet Studio", platform: "web" } });
  });

  it("says people and person when the app was never described", async () => {
    const res = await patch({ name: "Closet", one_liner: closet.one_liner, platform: "web" });
    expect(res.status).toBe(200);
    expect(h.updates[0].values).toEqual({ product_profile: { name: "Closet", one_liner: closet.one_liner, audience: "people", audience_one: "person", platform: "web" } });
  });

  it("names each field to fix and saves nothing", async () => {
    const res = await patch({ ...closet, one_liner: "fashion app", platform: "desktop" });
    expect(res.status).toBe(400);
    expect(Object.keys((await res.json()).fields).sort()).toEqual(["one_liner", "platform"]);
    expect(h.updates).toEqual([]);
  });
});
