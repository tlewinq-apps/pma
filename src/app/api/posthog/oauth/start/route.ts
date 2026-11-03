// "Sign in with PostHog": GET /api/posthog/oauth/start?app=<appId>&region=us|eu&return=<path>. An owner or admin is
// sent to PostHog's consent screen (PKCE, one project); PostHog comes back to /api/posthog/oauth/callback.
import { NextResponse } from "next/server";
import { appById } from "@/lib/db/app";
import { adminOnly, notFoundResponse } from "@/lib/api/guards";
import { safeReturnTo, startOAuth } from "@/lib/connections/oauth";
import { isRegion } from "@/lib/posthog/client";
import { posthogAuthorizeUrl } from "@/lib/posthog/oauth";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ctx = await appById(url.searchParams.get("app") ?? "");
  if (!ctx) return notFoundResponse();
  const denied = adminOnly(ctx);
  if (denied) return denied;
  const region = url.searchParams.get("region") ?? "us";
  if (!isRegion(region)) return NextResponse.json({ error: "Pick the US or EU PostHog cloud." }, { status: 400 });
  const returnTo = safeReturnTo(url.searchParams.get("return")) ?? `${ctx.base}/settings`;
  const { state, challenge } = await startOAuth({ provider: "posthog", orgId: ctx.org.id, projectId: ctx.project.id, userId: ctx.userId, returnTo, pkce: true, data: { region } });
  return NextResponse.redirect(posthogAuthorizeUrl(region, state, challenge!));
}
