// POST /api/apps/[appId]/sources: a file that can't be read is listed with a plain sentence. Screenshots are read by
// Claude (transcribeImage), so its API errors (no credit, busy) must never reach the page as raw JSON. Nothing is
// called for real: the readers, the queue and storage are stubbed.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { APIError } from "@anthropic-ai/sdk";

const h = vi.hoisted(() => ({ transcribe: vi.fn(), normalize: vi.fn() }));
vi.mock("@/lib/db/app", () => ({ appById: async () => ({ project: { id: "p1" } }) }));
vi.mock("@/lib/ingest/normalize", () => ({ transcribeImage: (...a: unknown[]) => h.transcribe(...a), normalizeFile: (...a: unknown[]) => h.normalize(...a) }));
vi.mock("@/lib/ingest/enqueue", () => ({ enqueueSource: vi.fn(async () => ({ id: "s1", duplicate: false })) }));
vi.mock("@/lib/ingest/drainRun", () => ({ runQueued: vi.fn() }));
vi.mock("@/lib/db/server", () => ({ serviceDb: () => ({ storage: { from: () => ({ upload: async () => ({ error: null }) }) } }) }));

import { POST } from "@/app/api/apps/[appId]/sources/route";

const upload = (name: string, type: string) => {
  const form = new FormData();
  form.append("files", new File([new Uint8Array([1, 2, 3])], name, { type }));
  return POST(new Request("http://x/api/apps/p1/sources", { method: "POST", body: form }), { params: Promise.resolve({ appId: "p1" }) });
};
const api = (status: number, type: string, message: string) => APIError.generate(status, { type: "error", error: { type, message } }, undefined, new Headers());

beforeEach(() => { h.transcribe.mockReset(); h.normalize.mockReset(); vi.spyOn(console, "error").mockImplementation(() => undefined); });

describe("a file PMA can't read", () => {
  it("a screenshot read while Claude is out of credit says so in plain words, never the API's JSON", async () => {
    h.transcribe.mockRejectedValue(api(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API."));
    const res = await upload("shot.png", "image/png");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors).toEqual([{ name: "shot.png", error: "PMA's Claude account is out of credit. Ask a PMA admin to add credit, then run it again." }]);
    expect(JSON.stringify(body)).not.toContain("invalid_request_error");
  });

  it("a busy Claude reads as busy", async () => {
    h.transcribe.mockRejectedValue(api(429, "rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit"));
    expect((await (await upload("shot.png", "image/png")).json()).errors[0].error).toBe("Claude is busy right now. Try again in a minute.");
  });

  it("a document reader's own plain sentence is kept", async () => {
    h.normalize.mockRejectedValue(new Error("This PDF has no text layer."));
    expect((await (await upload("notes.pdf", "application/pdf")).json()).errors[0]).toEqual({ name: "notes.pdf", error: "This PDF has no text layer." });
  });
});
