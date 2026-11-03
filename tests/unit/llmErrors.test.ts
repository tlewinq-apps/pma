import { describe, it, expect } from "vitest";
import { APIError, APIConnectionError, APIConnectionTimeoutError } from "@anthropic-ai/sdk";
import { friendlyLlmError, LLM_ERRORS } from "@/lib/llm/errors";
import { LlmStageError } from "@/lib/llm/client";

/** An error exactly as the SDK throws it for an HTTP answer: status, headers and the API's JSON body. */
const api = (status: number, type: string, message: string) =>
  APIError.generate(status, { type: "error", error: { type, message }, request_id: "req_011CTest" }, undefined, new Headers({ "request-id": "req_011CTest" }));

const CREDIT = api(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.");

describe("friendlyLlmError", () => {
  it("has the exact sentences", () => {
    expect(LLM_ERRORS).toEqual({
      credit: "PMA's Claude account is out of credit. Ask a PMA admin to add credit, then run it again.",
      key: "PMA's Claude key isn't valid. Ask an admin to check it.",
      ownCredit: "Your Claude key is out of credit. Add credit in the Claude Console (Plans & Billing), then run it again.",
      ownKey: "Your Claude key isn't valid any more. An owner or admin replaces it in Settings.",
      busy: "Claude is busy right now. Try again in a minute.",
      overloaded: "Claude is overloaded right now. Try again in a minute.",
      claude: "Claude couldn't finish this. Try again in a minute.",
      unreachable: "Couldn't reach Claude. Try again in a minute.",
      generic: "Something went wrong. Try again.",
    });
  });

  it("the SDK's message really is raw JSON, which is what people saw", () => {
    expect(CREDIT.message).toMatch(/^400 \{"type":"error","error":\{"type":"invalid_request_error","message":"Your credit balance is too low/);
  });

  it("maps a low credit balance on PMA's key to asking a PMA admin (the demo, and keyless customers during the beta)", () => {
    expect(friendlyLlmError(CREDIT)).toBe(LLM_ERRORS.credit);
    expect(LLM_ERRORS.credit).toBe("PMA's Claude account is out of credit. Ask a PMA admin to add credit, then run it again.");
    expect(LLM_ERRORS.credit).not.toMatch(/Claude Console|Your Claude/);
  });

  it("reads a sentence saved with the old credit wording as today's", () => {
    expect(friendlyLlmError("Your Claude account is out of credit. Add credit in the Claude Console (Plans & Billing), then run it again.")).toBe(LLM_ERRORS.credit);
  });

  it("maps a rejected key (401, or 403) to asking an admin", () => {
    expect(friendlyLlmError(api(401, "authentication_error", "invalid x-api-key"))).toBe(LLM_ERRORS.key);
    expect(friendlyLlmError(api(403, "permission_error", "Your API key does not have permission to use the specified resource."))).toBe(LLM_ERRORS.key);
  });

  it("maps 429 to busy and 529 to overloaded", () => {
    expect(friendlyLlmError(api(429, "rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit"))).toBe(LLM_ERRORS.busy);
    expect(friendlyLlmError(api(529, "overloaded_error", "Overloaded"))).toBe(LLM_ERRORS.overloaded);
  });

  it("gives any other API error a short sentence without JSON", () => {
    for (const e of [api(500, "api_error", "Internal server error"), api(400, "invalid_request_error", "prompt is too long: 250000 tokens > 200000 maximum")]) {
      const s = friendlyLlmError(e);
      expect(s).toBe(LLM_ERRORS.claude);
      expect(s).not.toMatch(/[{}]/);
    }
  });

  it("says Claude couldn't be reached when the connection fails or times out", () => {
    expect(friendlyLlmError(new APIConnectionError({ message: undefined }))).toBe(LLM_ERRORS.unreachable);
    expect(friendlyLlmError(new APIConnectionTimeoutError())).toBe(LLM_ERRORS.unreachable);
  });

  it("maps the same errors once stored as text, even cut short (older rows hold the raw message)", () => {
    expect(friendlyLlmError(CREDIT.message)).toBe(LLM_ERRORS.credit);
    expect(friendlyLlmError(CREDIT.message.slice(0, 200))).toBe(LLM_ERRORS.credit);
    expect(friendlyLlmError(api(529, "overloaded_error", "Overloaded").message)).toBe(LLM_ERRORS.overloaded);
    expect(friendlyLlmError(api(401, "authentication_error", "invalid x-api-key").message)).toBe(LLM_ERRORS.key);
    expect(friendlyLlmError(api(429, "rate_limit_error", "slow down").message)).toBe(LLM_ERRORS.busy);
    expect(friendlyLlmError('500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}')).toBe(LLM_ERRORS.claude);
  });

  it("explains a model answer PMA couldn't use", () => {
    for (const reason of ["refusal", "max_tokens", "no_text", "invalid_json"] as const) {
      const s = friendlyLlmError(new LlmStageError(`Invalid structured output: [{"code":"invalid_type"}]`, reason));
      expect(s).not.toMatch(/[{}[\]]/);
      expect(s).toMatch(/Claude/);
    }
  });

  it("keeps PMA's own plain sentences, and the friendly sentences themselves, as they are", () => {
    expect(friendlyLlmError(new Error("PMA needs a Claude key to read your code."))).toBe("PMA needs a Claude key to read your code.");
    for (const s of Object.values(LLM_ERRORS)) expect(friendlyLlmError(s)).toBe(s);
  });

  it("never passes JSON, very long text or a non-error through", () => {
    expect(friendlyLlmError(new Error('{"weird":true}'))).toBe(LLM_ERRORS.generic);
    expect(friendlyLlmError(new Error("x".repeat(400)))).toBe(LLM_ERRORS.generic);
    for (const e of [null, undefined, 42, {}, ""]) expect(friendlyLlmError(e)).toBe(LLM_ERRORS.generic);
  });
});

describe("where failures are shown", () => {
  const raw = CREDIT.message.slice(0, 200); // what the diagnosis row and older activity hold

  it("a failed source reads as a plain sentence, not the API's JSON", async () => {
    const { summarizeSource } = await import("@/lib/sources/summary");
    expect(summarizeSource({ status: "failed", kind: "paste", rawTextEmpty: false, error: CREDIT.message }, [], new Map(), new Set())).toBe(`Couldn't read: ${LLM_ERRORS.credit}`);
  });

  it("the activity log says why a first step, a lane action or a full flow failed in plain words", async () => {
    const { describeActivity } = await import("@/lib/queries/issueHelpers");
    for (const kind of ["diagnosis_failed", "lane_action_failed", "flow_failed"]) {
      const { text } = describeActivity({ kind, payload: { type: "bug", lane: "explore", error: raw } } as never);
      expect(text, kind).toContain(LLM_ERRORS.credit);
      expect(text, kind).not.toMatch(/[{}]/);
    }
  });

  it("proposals say why they didn't come, until newer proposals land", async () => {
    const { proposalFailure } = await import("@/lib/proposals");
    const failed = { kind: "lane_action_failed", payload: { lane: "diagnosis", error: raw } };
    expect(proposalFailure([failed])).toBe(`Proposals didn't finish: ${LLM_ERRORS.credit}`);
    expect(proposalFailure([{ kind: "proposals_ready", payload: {} }, failed])).toBeNull();
    expect(proposalFailure([{ kind: "lane_action_failed", payload: { lane: "alerts", error: raw } }])).toBeNull();
  });
});
