// OAuth hand-offs (Slack "Add to Slack", PostHog, Connect with GitHub). The browser carries a random state; the database
// keeps only its sha256 (oauth_states), with who started it, for which company and app, where to return, and a PKCE
// verifier when the provider takes one. The callback takes the row exactly once and only for the person who started it.
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";

const STATE_TTL_MS = 10 * 60_000;

export type OAuthProvider = "slack" | "posthog" | "github";
export type OAuthState = {
  provider: OAuthProvider; org_id: string; project_id: string | null; user_id: string; code_verifier: string | null;
  return_to: string | null; data: Record<string, unknown>; expires_at: string;
};

const b64url = (b: Buffer) => b.toString("base64url");
export const hashState = (state: string) => createHash("sha256").update(state).digest("hex");

/** PKCE (RFC 7636, S256): a random verifier and its challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

/** Only a path on this site: "/acme/web/settings", never "//evil.example" or "https://…". */
export function safeReturnTo(v: unknown): string | null {
  if (typeof v !== "string" || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\") || v.length > 300) return null;
  return /^[\w\-./?=&%#]+$/.test(v) ? v : null;
}

export async function startOAuth(
  s: { provider: OAuthProvider; orgId: string; projectId: string | null; userId: string; returnTo: string | null; pkce?: boolean; data?: Record<string, unknown> },
  db: SupabaseClient = serviceDb(),
): Promise<{ state: string; challenge: string | null }> {
  const state = b64url(randomBytes(32));
  const pair = s.pkce ? pkcePair() : null;
  const { error } = await db.from("oauth_states").insert({
    state_hash: hashState(state), provider: s.provider, org_id: s.orgId, project_id: s.projectId, user_id: s.userId,
    code_verifier: pair?.verifier ?? null, return_to: safeReturnTo(s.returnTo), data: s.data ?? {},
    expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });
  if (error) throw new Error(`saving the OAuth state failed: ${error.message}`);
  // Old hand-offs nobody finished: tidy them as we go.
  await db.from("oauth_states").delete().lt("expires_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString());
  return { state, challenge: pair?.challenge ?? null };
}

export type TakeResult = { ok: true; state: OAuthState } | { ok: false; reason: "unknown" | "expired" | "wrong_user" };

/** Takes the hand-off for this state once (deleting it), checking provider, expiry and that the same person returned. */
export async function takeOAuth(provider: OAuthProvider, state: string | null, userId: string, db: SupabaseClient = serviceDb()): Promise<TakeResult> {
  if (!state || state.length > 200) return { ok: false, reason: "unknown" };
  const { data, error } = await db.from("oauth_states").delete().eq("state_hash", hashState(state)).eq("provider", provider).select("*").maybeSingle();
  if (error || !data) return { ok: false, reason: "unknown" };
  const row = data as OAuthState;
  if (Date.parse(row.expires_at) < Date.now()) return { ok: false, reason: "expired" };
  if (row.user_id !== userId) return { ok: false, reason: "wrong_user" };
  return { ok: true, state: row };
}

/** Where to send the person after a hand-off: back where they started, with what happened in the query. */
export function backTo(returnTo: string | null, fallback: string, params: Record<string, string>): string {
  const base = returnTo ?? fallback;
  const [path, hash] = base.split("#");
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${new URLSearchParams(params).toString()}${hash ? `#${hash}` : ""}`;
}
