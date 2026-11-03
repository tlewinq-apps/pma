import { NextResponse, after } from "next/server";
import { appForIssue } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { userDb } from "@/lib/db/server";
import { proposeOnly } from "@/lib/actions/solveAndDraft";
import { logLaneActionFailed } from "@/lib/actions/laneFailure";
import { slackSyncNow } from "@/lib/slack/hooks";
import { awaitingDiagnosis, parseDiagnosis } from "@/lib/diagnosis/model";
import { checkFirst } from "@/lib/diagnosis/checks";
import { claudeAvailable } from "@/lib/connections/claude";
export const maxDuration = 300;

/** Generate proposals (no draft) for an issue in any lane. Runs after the response; the workspace polls for them. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = await appForIssue(id);
  if (!app) return notFoundResponse();
  const { data: issue } = await (await userDb()).from("issues").select("id, lane, status, type, diagnosis").eq("id", id).maybeSingle(); // RLS-scoped
  if (!issue) return notFoundResponse();
  if (awaitingDiagnosis(issue.type, parseDiagnosis(issue.diagnosis))) return NextResponse.json({ error: checkFirst(issue.type) }, { status: 409 });
  if (!(await claudeAvailable(app.project.id))) return NextResponse.json({ error: "Proposals need a Claude key. An owner or admin adds your Claude API key on Start here or in Settings." }, { status: 503 });
  if (issue.status === "drafting") return NextResponse.json({ error: "A draft is in progress" }, { status: 409 });
  after(async () => {
    try { await proposeOnly(id, issue.lane === "quick_win" ? 1 : 3); } catch (e) { await logLaneActionFailed(id, issue.lane ?? "", e); }
    await slackSyncNow(id);
  });
  return NextResponse.json({ ok: true });
}
