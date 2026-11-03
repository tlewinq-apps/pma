import { NextResponse, after } from "next/server";
import { appForIssue } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { userDb, serviceDb } from "@/lib/db/server";
import { getIssueDetail, parseIssuePatch } from "@/lib/queries/issueDetail";
import { rescoreIssue } from "@/lib/pipeline/run";
import { pipelineDeps } from "@/lib/pipeline/deps";
import { advanceDemoDrafts } from "@/lib/drafts/demoRepo";
import { demoAdvanceDue } from "@/lib/drafts/demo";
import { slackSyncLater } from "@/lib/slack/hooks";
export const maxDuration = 300;

export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await appForIssue(id))) return notFoundResponse();
  let d = await getIssueDetail(id); // RLS-scoped: only advance demo drafts on issues this user can see
  if (d && demoAdvanceDue(d.draft, Date.now())) { await advanceDemoDrafts({ issueId: id }); d = await getIssueDetail(id); slackSyncLater(id); }
  return d ? NextResponse.json(d) : notFoundResponse();
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await appForIssue(id);
  if (!ctx) return notFoundResponse();
  const p = parseIssuePatch(await req.json().catch(() => null));
  if ("error" in p) return NextResponse.json(p, { status: 400 });
  const db = await userDb();
  const { data: before } = await db.from("issues").select("type, title").eq("id", id).single();
  if (!before) return notFoundResponse();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (p.assign !== undefined) patch.owner_id = p.assign === "me" ? ctx.userId : null;
  if (p.title !== undefined) patch.title = p.title;
  if (p.type) patch.type = p.type;
  if (p.decision !== undefined) patch.decision = p.decision;
  if (p.dismiss) patch.status = "dismissed";
  const { error: updateError } = await db.from("issues").update(patch).eq("id", id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  const svc = serviceDb();
  if (p.assign !== undefined) await svc.from("activity").insert({ issue_id: id, user_id: ctx.userId, kind: "assigned", payload: { to: p.assign } });
  if (p.decision !== undefined) await svc.from("activity").insert({ issue_id: id, user_id: ctx.userId, kind: "decision", payload: { text: p.decision } });
  if (p.title !== undefined && p.title !== before.title) await svc.from("activity").insert({ issue_id: id, user_id: ctx.userId, kind: "retitled", payload: { from: before.title, to: p.title } });
  if (p.dismiss) await svc.from("activity").insert({ issue_id: id, user_id: ctx.userId, kind: "dismissed", payload: {} });
  if (p.type && p.type !== before.type) {
    await svc.from("activity").insert({ issue_id: id, user_id: ctx.userId, kind: "relabeled", payload: { from: before.type, to: p.type } });
    const { data: units } = await svc.from("feedback_units").select("id").eq("issue_id", id);
    await svc.from("label_corrections").insert((units ?? []).map((u) => ({ project_id: ctx.project.id, unit_id: u.id, field: "type", old_value: before.type, new_value: p.type!, user_id: ctx.userId })));
    await svc.from("feedback_units").update({ type: p.type }).eq("issue_id", id);
    after(() => rescoreIssue(pipelineDeps(), ctx.project.id, id).then(() => undefined));
  }
  slackSyncLater(id);
  return NextResponse.json({ ok: true });
}
