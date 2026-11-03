import { NextResponse } from "next/server";
import { appById } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { slackEnabled } from "@/lib/env";
import { slackMatches } from "@/lib/slack/users";
import { slackIsMine } from "@/lib/slack/ownership";
import { inSlackFor } from "@/lib/slack/tenant";

/**
 * Whether Slack knows the signed-in member's email yet. The welcome tour's Join Slack step ticks itself off on this;
 * slackMatches checks a member Slack doesn't know again on every call, so joining shows up on the next poll. The email is
 * only ever looked up in the app's own workspace.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ appId: string }> }) {
  const ctx = await appById((await params).appId);
  if (!ctx) return notFoundResponse();
  if (!slackEnabled() || !ctx.email || !(await slackIsMine(ctx.project.id))) return NextResponse.json({ joined: false });
  const match = await inSlackFor(ctx.project.id, () => slackMatches([{ userId: ctx.userId, email: ctx.email }]));
  return NextResponse.json({ joined: match?.get(ctx.userId) === "matched" });
}
