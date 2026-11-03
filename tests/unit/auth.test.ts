import { it, expect } from "vitest";
import { isPublicPath, signedOutResponse } from "@/lib/auth";
import { config } from "@/proxy";

it("isPublicPath respects path boundaries", () => {
  for (const p of ["/sign-in", "/auth/callback", "/api/v1/issues", "/api/v1", "/api/mcp", "/widget.js", "/favicon.ico", "/_next/static/a.js", "/api/widget/feedback", "/api/cron/process", "/api/github/webhook", "/api/drafts/callback", "/api/slack/events", "/api/slack/interactions", "/invite/x", "/join/x", "/invite", "/join", "/api/granola/webhook/abc", "/oauth/posthog-client.json"]) {
    expect(isPublicPath(p), p).toBe(true);
  }
  for (const p of ["/", "/authx", "/sign-in-x", "/api/v1-internal", "/widget.json", "/api/apps/x/sources", "/feedback", "/api/apps/x/alerts/digest", "/api/apps/x/feedback/recordings", "/api/apps/x/feedback/recordings/upload-url", "/api/issues/x/approve", "/api/sources/x/retry", "/flows", "/api/widgetx", "/api/apps/x/slack/test", "/api/apps/x/slack/setup", "/api/slack", "/api/slack/eventsx", "/invites", "/joinx", "/api/slack/install", "/api/slack/oauth/callback", "/api/posthog/oauth/start", "/api/posthog/oauth/callback", "/oauth/other", "/api/granola", "/api/mcpx"]) {
    expect(isPublicPath(p), p).toBe(false);
  }
});

it("signed out, public paths pass, API paths get 401 and pages go to sign-in", () => {
  for (const p of ["/invite/x", "/join/x", "/invite", "/join", "/sign-in", "/auth/callback", "/api/v1/issues", "/api/mcp"]) expect(signedOutResponse(p), p).toBe("pass");
  for (const p of ["/api/apps/x/sources", "/api/apps/x/settings", "/api/apps/x/slack/test", "/api/issues/x/approve"]) expect(signedOutResponse(p), p).toBe("unauthorized");
  for (const p of ["/", "/work", "/demo/celeste", "/invites", "/joinx", "/no-company"]) expect(signedOutResponse(p), p).toBe("sign-in");
});

// The matcher is path-to-regexp syntax, but this one is a plain regular expression group, so it can be tested as one.
const proxyRuns = (p: string) => new RegExp(`^${config.matcher[0]}$`).test(p);

it("the proxy runs on /invite and /join so their session is refreshed", () => {
  for (const p of ["/invite/x", "/join/x", "/invite", "/join", "/work", "/demo/celeste", "/api/apps/x/sources", "/invites"]) expect(proxyRuns(p), p).toBe(true);
  // OAuth hand-offs need the signed-in session: the person who started one must be the one who finishes it.
  for (const p of ["/api/slack/install", "/api/slack/oauth/callback", "/api/posthog/oauth/start", "/api/posthog/oauth/callback", "/oauth/posthog-client"]) expect(proxyRuns(p), p).toBe(true);
});

it("every path the proxy skips is public", () => {
  for (const p of ["/sign-in", "/auth/callback", "/api/widget/feedback", "/api/cron/process", "/api/github/webhook", "/api/drafts/callback", "/api/v1/issues", "/api/mcp", "/api/slack/events", "/api/slack/interactions", "/api/granola/webhook/abc", "/oauth/posthog-client.json", "/widget.js", "/favicon.ico", "/_next/static/a.js"]) {
    expect(proxyRuns(p), p).toBe(false);
    expect(isPublicPath(p), p).toBe(true);
  }
});
