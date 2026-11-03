import { NextResponse } from "next/server";
import { appForIssue } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { serviceDb } from "@/lib/db/server";
import { parseCommentBody } from "@/lib/queries/projectHelpers";
import { displayNames } from "@/lib/slack/users";
import { slackSyncLater } from "@/lib/slack/hooks";

/**
 * An update or a comment on a project (an owned issue), or a reply to one. Stored as a "commented" activity row, the
 * same kind a Slack thread reply writes, so it shows in the issue's Activity and is posted to its Slack thread.
 * Replies stay one level deep: answering a reply joins its thread. Commenting never assigns the issue.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await appForIssue(id); // members only
  if (!ctx) return notFoundResponse();
  const body = parseCommentBody(await req.json().catch(() => null));
  if ("error" in body) return NextResponse.json(body, { status: 400 });

  const svc = serviceDb();
  const payload: Record<string, unknown> = { text: body.text, source: "web" };
  if (body.replyTo !== null) {
    const { data: parent } = await svc.from("activity").select("id, user_id, payload").eq("id", body.replyTo).eq("issue_id", id).eq("kind", "commented").maybeSingle();
    if (!parent) return NextResponse.json({ error: "that comment is gone" }, { status: 400 });
    const p = (parent.payload ?? {}) as Record<string, unknown>;
    const root = Number(p.reply_to) || Number(parent.id);
    const name = parent.user_id ? (await displayNames(ctx.project.id, [parent.user_id])).get(parent.user_id) : typeof p.name === "string" ? p.name : null;
    payload.reply_to = root;
    if (name) payload.reply_to_name = name;
  }
  const { data: row, error } = await svc.from("activity").insert({ issue_id: id, user_id: ctx.userId, kind: "commented", payload }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  slackSyncLater(id);
  return NextResponse.json({ ok: true, id: Number(row.id) });
}
