// The company's own Claude key: checked with Anthropic before it's saved (src/lib/connections/claude.ts), then used for
// every Claude call made for that company's apps (withAppClaude in src/lib/llm/client.ts). No real API is called.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { z } from "zod";

const h = vi.hoisted(() => ({
  resolved: { apiKey: null as string | null, connectionId: null as string | null, sharedFallback: true },
  made: [] as (string | undefined)[],
  broken: [] as string[],
  createError: null as unknown,
}));

// The SDK as callStructured sees it: each client remembers the key it was made with and answers with valid JSON.
vi.mock("@anthropic-ai/sdk", async (orig) => {
  const real = await orig<typeof import("@anthropic-ai/sdk")>();
  class Fake {
    static AuthenticationError = real.default.AuthenticationError;
    static PermissionDeniedError = real.default.PermissionDeniedError;
    static RateLimitError = real.default.RateLimitError;
    static APIConnectionError = real.default.APIConnectionError;
    static APIError = real.default.APIError;
    apiKey: string | undefined;
    constructor(opts?: { apiKey?: string }) { this.apiKey = opts?.apiKey; h.made.push(opts?.apiKey); }
    beta = { messages: { create: () => {
      if (h.createError) return Promise.reject(h.createError);
      return Promise.resolve({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ usedKey: this.apiKey ?? "deployment" }) }] });
    } } };
  }
  return { ...real, default: Fake };
});
vi.mock("@/lib/connections/claude", async (orig) => ({
  ...(await orig<typeof import("@/lib/connections/claude")>()),
  resolveAppClaude: async () => h.resolved,
  markClaudeKeyBroken: async (id: string) => { h.broken.push(id); },
}));

import { callStructured, claudeReady, NO_COMPANY_KEY, withAppClaude } from "@/lib/llm/client";
import { claudeKeyProblem, keyErrorText, verifyClaudeKey } from "@/lib/connections/claude";

const APP = "11111111-1111-4111-8111-111111111111";
const KEY = "sk-ant-api03-" + "a".repeat(40);
const ask = () => callStructured({ system: "s", user: "u", schema: z.object({ usedKey: z.string() }), effort: "low" });
const authError = () => APIError.generate(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, undefined, new Headers());

beforeEach(() => {
  h.resolved = { apiKey: null, connectionId: null, sharedFallback: true };
  h.made = []; h.broken = []; h.createError = null;
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-deployment");
});
afterEach(() => vi.unstubAllEnvs());

describe("checking a key before it's saved", () => {
  it("refuses something that isn't a Claude key without calling Anthropic", async () => {
    expect(claudeKeyProblem("phx_123")).toMatch(/start with sk-ant-/);
    const make = vi.fn();
    expect(await verifyClaudeKey("not a key", make)).toEqual({ ok: false, error: expect.stringMatching(/sk-ant-/) });
    expect(make).not.toHaveBeenCalled();
  });

  it("lists models, then makes a one-token Haiku call", async () => {
    const list = vi.fn(async () => ({ data: [] }));
    const create = vi.fn(async () => ({}));
    const make = vi.fn(() => ({ models: { list }, messages: { create } }) as unknown as Anthropic);
    expect(await verifyClaudeKey(KEY, make)).toEqual({ ok: true });
    expect(make).toHaveBeenCalledWith(KEY);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-haiku-5-5", max_tokens: 1 }));
  });

  it("says plainly when Anthropic refuses the key", async () => {
    const make = () => ({ models: { list: async () => { throw authError(); } }, messages: { create: vi.fn() } }) as unknown as Anthropic;
    const r = await verifyClaudeKey(KEY, make);
    expect(r).toEqual({ ok: false, error: "Anthropic didn't accept that key. Check it was copied in full, or make a new one." });
    expect(keyErrorText(new Error("boom"))).toBe("Couldn't check that key. Try again in a moment.");
  });
});

describe("whose key a call runs on", () => {
  it("outside an app, and for an app without its own key, uses the deployment's key", async () => {
    expect(await ask()).toEqual({ usedKey: "deployment" });
    expect(claudeReady()).toBe(true);
    await withAppClaude(APP, async () => {
      expect(claudeReady()).toBe(true);
      expect(await ask()).toEqual({ usedKey: "deployment" });
    });
  });

  it("uses the company's own key inside withAppClaude, even with no deployment key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    h.resolved = { apiKey: KEY, connectionId: "conn-1", sharedFallback: true };
    expect(claudeReady()).toBe(false);
    await withAppClaude(APP, async () => {
      expect(claudeReady()).toBe(true);
      expect(await ask()).toEqual({ usedKey: KEY });
      // Nested work for the same app keeps the same key without another lookup.
      expect(await withAppClaude(APP, ask)).toEqual({ usedKey: KEY });
    });
  });

  it("refuses to fall back to the deployment's key when the company must bring its own", async () => {
    h.resolved = { apiKey: null, connectionId: null, sharedFallback: false };
    await withAppClaude(APP, async () => {
      expect(claudeReady()).toBe(false);
      await expect(ask()).rejects.toThrow(NO_COMPANY_KEY);
    });
  });

  it("marks the company's key Needs attention when Anthropic stops accepting it", async () => {
    h.resolved = { apiKey: KEY, connectionId: "conn-9", sharedFallback: true };
    h.createError = authError();
    await withAppClaude(APP, async () => { await expect(ask()).rejects.toBeInstanceOf(Anthropic.AuthenticationError); });
    expect(h.broken).toEqual(["conn-9"]);
    // A failure on the deployment's key is not the company's to fix.
    h.resolved = { apiKey: null, connectionId: null, sharedFallback: true };
    await withAppClaude(APP, async () => { await expect(ask()).rejects.toBeInstanceOf(Anthropic.AuthenticationError); });
    expect(h.broken).toEqual(["conn-9"]);
  });
});
