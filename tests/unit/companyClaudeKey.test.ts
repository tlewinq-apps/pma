// Whose Claude key a call ran on decides who is asked to fix it, and a company's mock-ups run on its own key like the
// rest of its Claude work. resolveAppClaude is faked: one company has its own key, the demo has none.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { APIError } from "@anthropic-ai/sdk";
import type { z } from "zod";

vi.mock("@/lib/connections/claude", () => ({
  resolveAppClaude: vi.fn(async (projectId: string) => projectId === "own-key"
    ? { apiKey: "sk-ant-company-key-0000000000000000", connectionId: "conn-1", sharedFallback: false }
    : { apiKey: null, connectionId: null, sharedFallback: true }),
  markClaudeKeyBroken: vi.fn(async () => {}),
}));

import Anthropic from "@anthropic-ai/sdk";
import { claudeReady, ownKeyWording, withAppClaude, type StructuredCaller } from "@/lib/llm/client";
import { friendlyLlmError, LLM_ERRORS } from "@/lib/llm/errors";
import { runMockDraft } from "@/lib/drafts/mockRunner";
import { WEB_FRAME } from "@/lib/marver/frameSize";
import { closet, fakeSnap } from "./fixtures/closetRepo";

const api = (status: number, type: string, message: string) =>
  APIError.generate(status, { type: "error", error: { type, message }, request_id: "req_011CTest" }, undefined, new Headers({ "request-id": "req_011CTest" }));
const credit = () => api(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.");
const CREDIT = credit();
const BAD_KEY = api(401, "authentication_error", "invalid x-api-key");

beforeEach(() => vi.stubEnv("ANTHROPIC_API_KEY", ""));
afterEach(() => vi.unstubAllEnvs());

describe("out of credit, by whose key it is", () => {
  it("on the company's own key, the company adds credit or replaces the key; the SDK error keeps its class", async () => {
    const low = await withAppClaude("own-key", async () => ownKeyWording(credit()));
    expect(low).toBeInstanceOf(Anthropic.BadRequestError);
    expect((low as Error).message).toBe(LLM_ERRORS.ownCredit);
    expect(friendlyLlmError(low)).toBe("Your Claude key is out of credit. Add credit in the Claude Console (Plans & Billing), then run it again.");
    // Stored as text (a source's or a flow's error), it reads the same.
    expect(friendlyLlmError((low as Error).message)).toBe(LLM_ERRORS.ownCredit);
    const key = await withAppClaude("own-key", async () => ownKeyWording(api(401, "authentication_error", "invalid x-api-key")));
    expect(key).toBeInstanceOf(Anthropic.AuthenticationError);
    expect(friendlyLlmError(key)).toBe(LLM_ERRORS.ownKey);
    // Saying it again changes nothing.
    expect(await withAppClaude("own-key", async () => friendlyLlmError(ownKeyWording(low)))).toBe(LLM_ERRORS.ownCredit);
  });

  it("on PMA's key (the demo, a keyless company, outside any app) it stays PMA's to fix", async () => {
    expect(friendlyLlmError(await withAppClaude("demo", async () => ownKeyWording(CREDIT)))).toBe(LLM_ERRORS.credit);
    expect(friendlyLlmError(ownKeyWording(CREDIT))).toBe(LLM_ERRORS.credit);
    expect(friendlyLlmError(ownKeyWording(BAD_KEY))).toBe(LLM_ERRORS.key);
  });

  it("leaves every other error alone", async () => {
    const busy = api(529, "overloaded_error", "Overloaded");
    expect(await withAppClaude("own-key", async () => ownKeyWording(busy))).toBe(busy);
    expect(friendlyLlmError(busy)).toBe(LLM_ERRORS.overloaded);
  });
});

describe("the mock runner draws on the app's company key", () => {
  const issueId = "0b9e6a3c-1d2f-4a5b-8c7d-9e0f1a2b3c4d";
  const draftId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
  const payload = {
    draft_id: draftId, branch: "pma/ab12cd-x", mode: "variant", target_frames: [], issue_short_id: "ab12cd",
    title: "Image overflows", problem: "The look doesn't fit", type: "bug", solution: "Fit the look: The whole look fits in the popup", quotes: ["I have to scroll"],
    issue_url: `https://v.app/issues/${issueId}`, callback_url: "https://v.app/api/drafts/callback", callback_token: "t".repeat(48),
    upload_slots: Array.from({ length: 4 }, (_, k) => ({ path: `${issueId}/${draftId}/slot-${k}.png`, url: `https://storage/slot-${k}` })),
  };
  const PATH = "src/screens/Studio.web.tsx";
  const code = { repo_full_name: "acme/Closet", watched_branch: null, spans: [{ path: PATH, from: 3, to: 3 }], screen: "Studio result", size: WEB_FRAME, context: "" };
  /** Records whether a key was in force when Claude was asked, then fails the draft (the drawing itself isn't under test). */
  const run = async (projectId: string | undefined) => {
    const ready: boolean[] = [];
    const llm = vi.fn(async (o: { schema: z.ZodTypeAny }) => { void o; ready.push(claudeReady()); throw credit(); }) as unknown as StructuredCaller;
    const post = vi.fn<(url: string, body: unknown) => Promise<void>>(async () => {});
    await runMockDraft(payload, {
      delayMs: 0, post, markFailed: vi.fn(), llm, loadScreens: async () => [],
      openRepo: async () => fakeSnap({ [PATH]: "line 1\nline 2\n<Modal />\nline 4\n" }),
      app: { profile: closet, code, ...(projectId ? { projectId } : {}) },
    });
    return { ready, error: (post.mock.calls[0][1] as { error: string }).error };
  };

  it("an approximate mock-up's Claude calls run on the company's own key, and its credit is the company's to add", async () => {
    const { ready, error } = await run("own-key");
    expect(ready).toEqual([true]);
    expect(error).toBe(LLM_ERRORS.ownCredit);
  });

  it("without the app it falls back as before: no key here, and PMA's credit", async () => {
    const { ready, error } = await run(undefined);
    expect(ready).toEqual([false]);
    expect(error).toBe(LLM_ERRORS.credit);
  });
});
