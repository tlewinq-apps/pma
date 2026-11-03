import { AsyncLocalStorage } from "node:async_hooks";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { LLM_ERRORS, friendlyLlmError } from "./errors";

export const MODEL = "claude-opus-5-5";
export type Effort = "low" | "medium" | "high";
export class LlmStageError extends Error {
  constructor(message: string, readonly reason: "refusal" | "max_tokens" | "no_text" | "invalid_json") { super(message); }
}

// Whose key a Claude call runs on. withAppClaude(projectId, fn) runs fn with the app's company key when it has one
// (src/lib/connections/claude.ts). Outside it, and for the demo app, calls use the deployment's ANTHROPIC_API_KEY when a
// self-hoster sets one. A customer company without its own key gets NO_COMPANY_KEY.
type ClaudeScope = { projectId: string; apiKey: string | null; connectionId: string | null; sharedFallback: boolean };
const scope = new AsyncLocalStorage<ClaudeScope>();

/** The message a customer app gets when it must bring its own key and hasn't. src/lib/llm/errors.ts maps it. */
export const NO_COMPANY_KEY = "This company hasn't added its Claude API key yet. An owner or admin adds it on Start here or in Settings.";

let client: Anthropic | null = null;
const keyed = new Map<string, Anthropic>();
const getClient = () => {
  const s = scope.getStore();
  if (s && !s.apiKey && !s.sharedFallback) throw new Error(NO_COMPANY_KEY);
  if (!s?.apiKey) return (client ??= new Anthropic());
  let c = keyed.get(s.apiKey);
  if (!c) keyed.set(s.apiKey, (c = new Anthropic({ apiKey: s.apiKey })));
  return c;
};

/** Whether a Claude call made here has a key to run on: the app's company key, or the deployment's where allowed. */
export function claudeReady(): boolean {
  const s = scope.getStore();
  if (s?.apiKey) return true;
  return !!process.env.ANTHROPIC_API_KEY && (!s || s.sharedFallback);
}

/** Runs `fn` with this app's company Claude key in force for every callStructured inside it (nested calls included). */
export async function withAppClaude<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  if (scope.getStore()?.projectId === projectId) return fn();
  const { resolveAppClaude } = await import("@/lib/connections/claude"); // lazy: keeps the database client out of eval and scripts
  const k = await resolveAppClaude(projectId).catch((e: Error) => {
    console.error("[claude] key lookup failed", e.message);
    return { apiKey: null, connectionId: null, sharedFallback: true };
  });
  return scope.run({ projectId, ...k }, fn);
}

/** Wraps a caller so each call runs on the app's key (for code that takes a StructuredCaller and no project). */
export const appCaller = (projectId: string, caller: StructuredCaller = callStructured): StructuredCaller =>
  ((o) => withAppClaude(projectId, () => caller(o))) as StructuredCaller;

/** A company key Anthropic refuses (401/403) is marked Needs attention, so Settings says so. */
async function noteKeyError(e: unknown): Promise<void> {
  const s = scope.getStore();
  if (!s?.connectionId) return;
  if (!(e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)) return;
  const { markClaudeKeyBroken } = await import("@/lib/connections/claude");
  await markClaudeKeyBroken(s.connectionId, e instanceof Anthropic.AuthenticationError ? "Anthropic stopped accepting this key." : "This key can no longer use the Claude API.");
}

/**
 * A credit or key problem on the company's own key is the company's to fix, so it says so (LLM_ERRORS.ownCredit,
 * ownKey) rather than naming PMA's. The SDK error keeps its class and status, with the sentence as its message, so a
 * caller that stores the message stores the right sentence. On PMA's key, and for any other error, `e` is unchanged.
 */
export function ownKeyWording(e: unknown): unknown {
  if (!scope.getStore()?.apiKey) return e;
  const said = friendlyLlmError(e);
  const own = said === LLM_ERRORS.credit ? LLM_ERRORS.ownCredit : said === LLM_ERRORS.key ? LLM_ERRORS.ownKey : null;
  if (!own) return e;
  if (e instanceof Error) { e.message = own; return e; }
  return new Error(own, { cause: e });
}

/** `user` is plain text, or content blocks when an image must be sent (screenshots). */
export type UserContent = string | Anthropic.Beta.Messages.BetaContentBlockParam[];

export async function callStructured<T extends z.ZodTypeAny>(o: {
  system: string; user: UserContent; schema: T; effort: Effort; maxTokens?: number;
}): Promise<z.infer<T>> {
  const res = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: o.maxTokens ?? 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: o.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: o.user }],
    output_config: { effort: o.effort, format: zodOutputFormat(o.schema) },
  }).catch(async (e: unknown) => { await noteKeyError(e); throw ownKeyWording(e); });
  if (res.stop_reason === "refusal") throw new LlmStageError("Model declined", "refusal");
  if (res.stop_reason === "max_tokens") throw new LlmStageError("Output truncated", "max_tokens");
  const block = res.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new LlmStageError("No text block", "no_text");
  try {
    return o.schema.parse(JSON.parse(block.text));
  } catch (e) {
    throw new LlmStageError(`Invalid structured output: ${(e as Error).message}`, "invalid_json");
  }
}
export type StructuredCaller = typeof callStructured;

export type ToolMessage = Anthropic.Beta.Messages.BetaMessageParam;
export type ToolDef = Anthropic.Beta.Messages.BetaTool;
export type ToolReply = Anthropic.Beta.Messages.BetaMessage;

/**
 * One turn of a conversation where Claude uses tools (Build it), on the app's key like callStructured (run it inside
 * withAppClaude), with the same key handling and the company-key wording on credit and key errors. The caller runs
 * the tools and sends their results back as the next user turn. `timeoutMs` is how long this turn may take: the
 * caller's own time budget, which also lets a large `maxTokens` go without streaming.
 */
export async function callWithTools(o: { system: string; messages: ToolMessage[]; tools: ToolDef[]; effort: Effort; maxTokens?: number; timeoutMs?: number }): Promise<ToolReply> {
  return getClient().beta.messages.create({
    model: MODEL,
    max_tokens: o.maxTokens ?? 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: o.system, cache_control: { type: "ephemeral" } }],
    messages: o.messages,
    tools: o.tools,
    output_config: { effort: o.effort },
  }, { timeout: o.timeoutMs ?? 240_000, maxRetries: 0 }).catch(async (e: unknown) => { await noteKeyError(e); throw ownKeyWording(e); });
}
export type ToolCaller = typeof callWithTools;
