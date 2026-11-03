// The company's own Claude API key: checked before it's saved (the models list, then a one-token call), kept in Vault,
// and used for that company's Claude calls (src/lib/llm/client.ts withAppClaude). Every company brings its own key:
// without one, its feedback waits and is requeued when the key is saved. Only the demo app may use the deployment's
// ANTHROPIC_API_KEY, and only when a self-hoster sets one; the hosted PMA leaves it unset.
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";
import { findConnection, markConnection, readSecret } from "./store";
import { NO_COMPANY_KEY } from "@/lib/llm/client";

/** Whether companies without their own key may use the deployment's. Off: every company brings its own key. */
export const SHARED_KEY_FALLBACK = false;

/** Whether the deployment's key may stand in for this company's: never for one that signed up on its own. */
export const fallbackAllowed = (org: { self_serve?: boolean | null } | null | undefined) => SHARED_KEY_FALLBACK && !org?.self_serve;

export const CHECK_MODEL = "claude-haiku-5-5";

export type KeyCheck = { ok: true } | { ok: false; error: string };

/** Anthropic keys start with sk-ant-. Anything else is a paste mistake, refused before a network call. */
export function claudeKeyProblem(key: string): string | null {
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return "That doesn't look like a Claude API key. Keys start with sk-ant- and come from console.anthropic.com.";
  return null;
}

/** What to tell the person when a check fails, from the SDK's typed errors. */
export function keyErrorText(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "Anthropic didn't accept that key. Check it was copied in full, or make a new one.";
  if (e instanceof Anthropic.PermissionDeniedError) return "That key can't use the Claude API. Check the workspace it belongs to allows API access.";
  if (e instanceof Anthropic.RateLimitError) return "Anthropic is rate limiting that key right now. Try again in a minute.";
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach Anthropic. Try again in a moment.";
  if (e instanceof Anthropic.APIError) return `Anthropic answered ${e.status ?? "with an error"}. Try again in a moment.`;
  return "Couldn't check that key. Try again in a moment.";
}

/** GET /v1/models, then a one-token call: the key exists and can run a model. Never logs the key. */
export async function verifyClaudeKey(key: string, make: (apiKey: string) => Anthropic = (apiKey) => new Anthropic({ apiKey, maxRetries: 0, timeout: 20_000 })): Promise<KeyCheck> {
  const problem = claudeKeyProblem(key);
  if (problem) return { ok: false, error: problem };
  const client = make(key);
  try {
    await client.models.list({ limit: 1 });
    await client.messages.create({ model: CHECK_MODEL, max_tokens: 1, thinking: { type: "disabled" }, messages: [{ role: "user", content: "ok" }] });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: keyErrorText(e) };
  }
}

type Resolved = { apiKey: string; connectionId: string } | null;
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: Resolved }>();

/** Forget cached keys (after saving or removing one), for one company or all. */
export function forgetClaudeKeys(orgId?: string): void {
  if (!orgId) cache.clear();
  else cache.delete(orgId);
}

/**
 * The key an app's Claude calls run on: its company's own key, and whether the deployment's key may stand in when there
 * is none (only for the demo, and only when the deployment sets ANTHROPIC_API_KEY). The
 * company key is cached for a minute per company; a failed lookup is not cached. The key never leaves the server.
 */
export async function resolveAppClaude(projectId: string, db: SupabaseClient = serviceDb()): Promise<{ apiKey: string | null; connectionId: string | null; sharedFallback: boolean }> {
  const { data: p, error } = await db.from("projects").select("org_id, kind, organizations(self_serve)").eq("id", projectId).maybeSingle();
  if (error) throw new Error(`app lookup failed: ${error.message}`);
  if (!p || p.kind === "demo") return { apiKey: null, connectionId: null, sharedFallback: true };
  const own = await companyKey(p.org_id as string, db);
  const org = (Array.isArray(p.organizations) ? p.organizations[0] : p.organizations) as { self_serve?: boolean } | null;
  return { apiKey: own?.apiKey ?? null, connectionId: own?.connectionId ?? null, sharedFallback: fallbackAllowed(org) };
}

/**
 * Feedback that failed only because its company had no key (NO_COMPANY_KEY, see llm/client.ts) goes back in the queue
 * once a key is saved, with its retries reset, so a self-serve company's first feedback isn't lost. How many went back.
 */
export async function requeueKeylessFeedback(orgId: string, db: SupabaseClient = serviceDb()): Promise<number> {
  const { data: apps, error } = await db.from("projects").select("id").eq("org_id", orgId);
  if (error) throw new Error(`app lookup failed: ${error.message}`);
  const ids = (apps ?? []).map((a) => a.id as string);
  if (!ids.length) return 0;
  const { data, error: e } = await db.from("sources").update({ status: "queued", attempts: 0, error: null, locked_at: null })
    .in("project_id", ids).eq("status", "failed").eq("error", NO_COMPANY_KEY).select("id");
  if (e) throw new Error(`requeue failed: ${e.message}`);
  return data?.length ?? 0;
}

/** A found key is cached for a minute; "no key" never is, so a key just added is used at once everywhere. */
async function companyKey(orgId: string, db: SupabaseClient): Promise<Resolved> {
  const hit = cache.get(orgId);
  if (hit?.value && Date.now() - hit.at < TTL_MS) return hit.value;
  const conn = await findConnection("anthropic", { orgId, projectId: null }, db);
  const apiKey = conn && conn.status === "ok" ? await readSecret(conn.id, db) : null;
  const value = conn && apiKey ? { apiKey, connectionId: conn.id } : null;
  if (value) cache.set(orgId, { at: Date.now(), value });
  else cache.delete(orgId);
  return value;
}

/** Whether this app can call Claude at all: its company's key, or the deployment's where allowed. */
export async function claudeAvailable(projectId: string): Promise<boolean> {
  const r = await resolveAppClaude(projectId).catch(() => ({ apiKey: null, sharedFallback: true }));
  return !!r.apiKey || (r.sharedFallback && !!process.env.ANTHROPIC_API_KEY);
}

/** Anthropic refused the company's key mid-run: mark it Needs attention so Settings and Start here say so. */
export async function markClaudeKeyBroken(connectionId: string, reason: string): Promise<void> {
  try {
    await markConnection(connectionId, "broken", reason);
    cache.clear();
  } catch (e) {
    console.error("[claude] could not mark the key broken", (e as Error).message);
  }
}
