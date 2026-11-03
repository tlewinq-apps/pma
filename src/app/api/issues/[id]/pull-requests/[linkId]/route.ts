// One linked pull request: PATCH sets or clears its preview link; DELETE removes a link pasted by mistake. Same people
// and the same window as linking: an owner, an admin or the issue's owner, while the issue is Ready to build (once it
// has shipped, the link is the record of what shipped).
import { NextResponse } from "next/server";
import { serviceDb } from "@/lib/db/server";
import { linkAccess, notReadyToLink } from "@/lib/api/prLinks";
import { notFoundResponse } from "@/lib/api/guards";
import { parsePreviewUrl } from "@/lib/handoff/build";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string; linkId: string }> };

async function findLink(issueId: string, linkId: string) {
  if (!UUID.test(linkId)) return null;
  const { data } = await serviceDb().from("pull_request_links").select("id, url, number, repo, preview_url").eq("id", linkId).eq("issue_id", issueId).maybeSingle();
  return data as { id: string; url: string; number: number; repo: string; preview_url: string | null } | null;
}

export async function PATCH(req: Request, { params }: Params) {
  const { id, linkId } = await params;
  const access = await linkAccess(id);
  if ("res" in access) return access.res;
  const closed = notReadyToLink(access.issue);
  if (closed) return closed;
  const link = await findLink(id, linkId);
  if (!link) return notFoundResponse();
  const body = (await req.json().catch(() => null)) as { preview?: unknown } | null;
  const preview = parsePreviewUrl(body?.preview);
  if (!preview.ok) return NextResponse.json({ error: preview.error, field: "preview" }, { status: 400 });
  const db = serviceDb();
  const { error } = await db.from("pull_request_links").update({ preview_url: preview.url }).eq("id", link.id);
  if (error) return NextResponse.json({ error: "Couldn't save the preview link. Try again." }, { status: 500 });
  if (preview.url !== link.preview_url) {
    await db.from("activity").insert({ issue_id: id, user_id: access.ctx.userId, kind: preview.url ? "preview_added" : "preview_removed", payload: { pr_number: link.number, ...(preview.url ? { preview_url: preview.url } : {}) } });
  }
  return NextResponse.json({ ok: true, preview: preview.url });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id, linkId } = await params;
  const access = await linkAccess(id);
  if ("res" in access) return access.res;
  const closed = notReadyToLink(access.issue);
  if (closed) return closed;
  const link = await findLink(id, linkId);
  if (!link) return notFoundResponse();
  const db = serviceDb();
  const { error } = await db.from("pull_request_links").delete().eq("id", link.id);
  if (error) return NextResponse.json({ error: "Couldn't remove the link. Try again." }, { status: 500 });
  await db.from("activity").insert({ issue_id: id, user_id: access.ctx.userId, kind: "pr_unlinked", payload: { pr_url: link.url, pr_number: link.number } });
  return NextResponse.json({ ok: true });
}
