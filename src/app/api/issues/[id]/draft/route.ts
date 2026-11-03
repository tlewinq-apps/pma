import { NextResponse } from "next/server";
import { appForIssue } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { userDb } from "@/lib/db/server";
import { startDraft } from "@/lib/actions/drafting";
import { slackSyncLater } from "@/lib/slack/hooks";

export const maxDuration = 300; // the mock runner (design agent and screenshots) runs after the response

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await appForIssue(id))) return notFoundResponse();
  const { solutionId } = await req.json().catch(() => ({}));
  if (typeof solutionId !== "string") return NextResponse.json({ error: "unknown solution" }, { status: 400 });
  const r = await startDraft(await userDb(), id, solutionId); // RLS-scoped
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  slackSyncLater(id); // in demo mode the sync also waits for the draft and posts the mockup
  return NextResponse.json({ ok: true });
}
