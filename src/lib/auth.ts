// Public (ungated) paths: a signed-out request to one of them is let through. src/proxy.ts skips most of them entirely
// (its `config.matcher`, which must remain a static literal for Next), and every path the matcher skips must be listed
// here. /invite and /join are public but still go through the proxy, so a signed-in visitor's session is refreshed
// there; their server actions check the token and the session themselves.
const PUBLIC_PREFIXES = ["/sign-in", "/auth", "/invite", "/join", "/api/widget", "/api/cron", "/api/github/webhook", "/api/drafts/callback", "/api/v1", "/api/slack/events", "/api/slack/interactions", "/api/granola/webhook", "/oauth/posthog-client.json"];
export function isPublicPath(pathname: string): boolean {
  if (pathname === "/widget.js" || pathname === "/favicon.ico" || pathname.startsWith("/_next/")) return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** What the proxy does with a signed-out request: let a public path through, answer an API call 401, send a page to sign-in. */
export function signedOutResponse(pathname: string): "pass" | "unauthorized" | "sign-in" {
  if (isPublicPath(pathname)) return "pass";
  return pathname.startsWith("/api/") ? "unauthorized" : "sign-in";
}
