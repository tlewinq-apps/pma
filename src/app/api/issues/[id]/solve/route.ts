import { NextResponse, after } from "next/server";
import { appForIssue } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { userDb } from "@/lib/db/server";
import { hasDraftInProgress } from "@/lib/github/dispatch";
import { solveAndDraft } from "@/lib/actions/solveAndDraft";
import { solveDecision } from "@/lib/actions/solveDecision";
import { isStaleDispatch } from "@/lib/drafts/inflight";
import { logLaneActionFailed } from "@/lib/actions/laneFailure";
import { slackSyncNow } from "@/lib/slack/hooks";
import { awaitingDiagnosis, parseDiagnosis } from "@/lib/diagnosis/model";
import { checkFirst } from "@/lib/diagnosis/checks";
export const maxDuration = 300;

/** Manual trigger/retry: propose solutions and dispatch a draft for an issue already in quick_win/explore. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await appForIssue(id))) return notFoundResponse();
  const db = await userDb(); // RLS-scoped: an issue from another project is simply not visible
  const { data: issue } = await db.from("issues").select("id,lane,status,type,diagnosis").eq("id", id).maybeSingle();
  const hasDispatchedDraft = issue ? await hasDraftInProgress(db, id) : false;
  const { data: latest } = issue
    ? await db.from("drafts").select("status,created_at").eq("issue_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  const d = solveDecision({ visible: !!issue, lane: issue?.lane, hasDispatchedDraft, status: issue?.status, latestDraftStale: isStaleDispatch(latest, Date.now()) });
  if (d === 404) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (d === 409) return NextResponse.json({ error: "draft in progress" }, { status: 409 });
  if (d === 400) return NextResponse.json({ error: "issue is not in Quick wins or Explore" }, { status: 400 });
  if (awaitingDiagnosis(issue!.type, parseDiagnosis(issue!.diagnosis))) return NextResponse.json({ error: checkFirst(issue!.type) }, { status: 409 });
  const lane = issue!.lane as string;
  after(async () => {
    try {
      await solveAndDraft(id, lane === "explore" ? 3 : 1);
    } catch (e) {
      await logLaneActionFailed(id, lane, e);
    }
    await slackSyncNow(id);
  });
  return NextResponse.json({ ok: true });
}
