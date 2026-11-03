import { NextResponse, after } from "next/server";
import { appForIssue } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { runDiagnosis, startDiagnosis } from "@/lib/diagnosis/run";
import { slackSyncNow } from "@/lib/slack/hooks";
export const maxDuration = 300;

/** Run an issue's first step (diagnostics, scoping, finding where it fits, mapping the steps). The run (simulated for the demo; a customer app's reads its repository) and the proposals written from it finish after the response; the workspace polls. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await appForIssue(id);
  if (!ctx) return notFoundResponse();
  const r = await startDiagnosis(id, ctx.userId, ctx.email || null, "web");
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  after(async () => {
    await slackSyncNow(id);
    await runDiagnosis(id, { afterFinding: slackSyncNow });
    await slackSyncNow(id);
  });
  return NextResponse.json({ ok: true });
}
