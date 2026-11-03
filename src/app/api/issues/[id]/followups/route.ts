import { NextResponse } from "next/server";
import { appForIssue } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { askFollowups } from "@/lib/slack/reporters";
import { slackSyncLater } from "@/lib/slack/hooks";
export const maxDuration = 60;

/** Ask the issue's drafted follow-up questions in each Slack reporter's own thread. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await appForIssue(id);
  if (!ctx) return notFoundResponse();
  const r = await askFollowups(id, ctx.userId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  slackSyncLater(id);
  return NextResponse.json(r);
}
