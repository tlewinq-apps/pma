// "Connect to Slack": GET /api/slack/install?app=<appId>&return=<path>. An owner or admin of the app's company is sent
// to Slack's consent screen for PMA's bot (OAuth v2); Slack comes back to /api/slack/oauth/callback with the state
// minted here. Anyone else gets the same 404 or 403 as every app route.
import { NextResponse } from "next/server";
import { appById } from "@/lib/db/app";
import { adminOnly, notFoundResponse } from "@/lib/api/guards";
import { slackOAuthEnabled } from "@/lib/env";
import { backTo, safeReturnTo, startOAuth } from "@/lib/connections/oauth";
import { slackAuthorizeUrl } from "@/lib/slack/install";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ctx = await appById(url.searchParams.get("app") ?? "");
  if (!ctx) return notFoundResponse();
  const denied = adminOnly(ctx);
  if (denied) return denied;
  const returnTo = safeReturnTo(url.searchParams.get("return")) ?? `${ctx.base}/settings`;
  if (!slackOAuthEnabled()) return NextResponse.redirect(new URL(backTo(returnTo, returnTo, { connect: "slack", error: "not_configured" }), url));
  const { state } = await startOAuth({ provider: "slack", orgId: ctx.org.id, projectId: ctx.project.id, userId: ctx.userId, returnTo });
  return NextResponse.redirect(slackAuthorizeUrl(state));
}
