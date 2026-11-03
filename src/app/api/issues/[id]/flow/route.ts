import { NextResponse, after } from "next/server";
import { appForIssue } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { runFlowDraft, startFlowDraft } from "@/lib/actions/flow";
import { slackSyncNow } from "@/lib/slack/hooks";
export const maxDuration = 300;

/** Create full flow for the issue's mock-up. The design agent plans and draws it after the response; the workspace polls. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await appForIssue(id);
  if (!ctx) return notFoundResponse();
  const r = await startFlowDraft(id, { userId: ctx.userId, name: ctx.email || null, via: "web" });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!r.already) {
    after(async () => {
      await slackSyncNow(id);
      await runFlowDraft(r.draftId);
      await slackSyncNow(id);
    });
  }
  return NextResponse.json({ ok: true, already: r.already ?? null });
}
