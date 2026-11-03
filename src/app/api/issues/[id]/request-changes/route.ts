import { NextResponse } from "next/server";
import { appForIssue } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { userDb } from "@/lib/db/server";
import { parseNote } from "@/lib/drafts/review";
import { requestChanges } from "@/lib/actions/drafting";
import { slackSyncLater } from "@/lib/slack/hooks";
export const maxDuration = 300; // the mock runner (design agent and screenshots) runs after the response

/** Re-drafts the reviewed proposal with the reviewer's note, then closes the PR it replaces. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await appForIssue(id);
  if (!ctx) return notFoundResponse();
  const parsed = parseNote(await req.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json(parsed, { status: 400 });
  const r = await requestChanges(await userDb(), id, ctx.userId, parsed.note); // RLS-scoped
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  slackSyncLater(id);
  return NextResponse.json({ ok: true });
}
