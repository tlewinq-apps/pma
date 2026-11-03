// Signing in with PostHog. PMA has no client registered with PostHog: its client_id is the URL of a Client ID
// Metadata Document this deployment serves (/oauth/posthog-client.json), which PostHog fetches. Public client, PKCE
// (S256), and required_access_level=project so the person picks one project on PostHog's consent screen.
import { env } from "@/lib/env";
import { posthogHost, type PostHogCredentials, type Region } from "./client";

export const POSTHOG_SCOPES = ["project:read", "query:read", "error_tracking:read"] as const;

const base = () => env.appUrl().replace(/\/+$/, "");
export const posthogClientId = () => `${base()}/oauth/posthog-client.json`;
export const posthogRedirectUri = () => `${base()}/api/posthog/oauth/callback`;

/** The metadata document PostHog reads for client_id. Must be served at exactly posthogClientId(). */
export function posthogClientMetadata() {
  return {
    client_id: posthogClientId(),
    client_name: "PMA",
    client_uri: base(),
    redirect_uris: [posthogRedirectUri()],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: POSTHOG_SCOPES.join(" "),
    "com.posthog": { scopes: [...POSTHOG_SCOPES] },
  };
}

export function posthogAuthorizeUrl(region: Region, state: string, challenge: string): string {
  const q = new URLSearchParams({
    client_id: posthogClientId(), redirect_uri: posthogRedirectUri(), response_type: "code", scope: POSTHOG_SCOPES.join(" "),
    state, code_challenge: challenge, code_challenge_method: "S256", required_access_level: "project",
  });
  return `${posthogHost(region)}/oauth/authorize/?${q.toString()}`;
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string; scoped_teams?: number[] };

async function tokenRequest(region: Region, form: Record<string, string>, f: typeof fetch = fetch): Promise<TokenResponse> {
  const r = await f(`${posthogHost(region)}/oauth/token/`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: posthogClientId(), ...form }), signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json().catch(() => null)) as (TokenResponse & { error?: string }) | null;
  if (!r.ok || !j?.access_token) throw new Error(`PostHog token request failed: ${j?.error ?? r.status}`);
  return j;
}

const toCreds = (t: TokenResponse, previousRefresh: string | null = null): PostHogCredentials => ({
  kind: "oauth", access_token: t.access_token, refresh_token: t.refresh_token ?? previousRefresh, expires_at: t.expires_in ? Date.now() + t.expires_in * 1000 : null,
});

/** Swaps the callback's code (with the PKCE verifier) for a token pair, and the projects the person picked. */
export async function exchangePosthogCode(region: Region, code: string, verifier: string, f?: typeof fetch): Promise<{ creds: PostHogCredentials; scopedProjects: number[] }> {
  const t = await tokenRequest(region, { grant_type: "authorization_code", code, redirect_uri: posthogRedirectUri(), code_verifier: verifier }, f);
  return { creds: toCreds(t), scopedProjects: Array.isArray(t.scoped_teams) ? t.scoped_teams.filter((n) => typeof n === "number") : [] };
}

export async function refreshPosthog(region: Region, refreshToken: string, f?: typeof fetch): Promise<PostHogCredentials> {
  return toCreds(await tokenRequest(region, { grant_type: "refresh_token", refresh_token: refreshToken }, f), refreshToken);
}

/** Best effort: tells PostHog to forget the token on Disconnect. */
export async function revokePosthog(region: Region, creds: PostHogCredentials, f: typeof fetch = fetch): Promise<void> {
  if (creds.kind !== "oauth") return;
  await f(`${posthogHost(region)}/oauth/revoke/`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: posthogClientId(), token: creds.refresh_token ?? creds.access_token }), signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}
