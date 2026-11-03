// Link pull request: an owner, an admin or the issue's owner pastes the pull request that builds this issue, with an
// optional preview link ("See it live"). The link must be a pull request in the app's connected repository; it is
// stored in one shape (https://github.com/<owner>/<repo>/pull/<n>), once per issue. Until the PMA GitHub App links
// pull requests from the "PMA: <id>" line on its own, this is how an issue finds its pull request. Only while the
// issue is Ready to build (lib/api/prLinks.ts notReadyToLink).
import { NextResponse } from "next/server";
import { serviceDb } from "@/lib/db/server";
import { linkAccess, notReadyToLink } from "@/lib/api/prLinks";
import { checkPullRequestUrl, parsePreviewUrl, PR_ALREADY_LINKED } from "@/lib/handoff/build";

const MAX_LINKS = 10;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await linkAccess(id);
  if ("res" in access) return access.res;
  const { ctx, issue } = access;
  const closed = notReadyToLink(issue);
  if (closed) return closed;

  const body = (await req.json().catch(() => null)) as { url?: unknown; preview?: unknown } | null;
  const pr = checkPullRequestUrl(body?.url, ctx.project.repo_full_name);
  if (!pr.ok) return NextResponse.json({ error: pr.error, field: "url" }, { status: 400 });
  const preview = parsePreviewUrl(body?.preview);
  if (!preview.ok) return NextResponse.json({ error: preview.error, field: "preview" }, { status: 400 });

  const db = serviceDb();
  const { data: existing } = await db.from("pull_request_links").select("id, repo, number").eq("issue_id", id);
  if ((existing ?? []).some((l) => String(l.repo).toLowerCase() === pr.repo.toLowerCase() && l.number === pr.number)) return NextResponse.json({ error: PR_ALREADY_LINKED, field: "url" }, { status: 409 });
  if ((existing ?? []).length >= MAX_LINKS) return NextResponse.json({ error: `An issue can have up to ${MAX_LINKS} linked pull requests.` }, { status: 409 });

  const { data: row, error } = await db.from("pull_request_links")
    .insert({ issue_id: id, url: pr.url, repo: pr.repo, number: pr.number, preview_url: preview.url, linked_by: ctx.userId })
    .select("id").single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: PR_ALREADY_LINKED, field: "url" }, { status: 409 });
    console.error("[pull-requests] couldn't link", id, error.message);
    return NextResponse.json({ error: "Couldn't link the pull request. Try again." }, { status: 500 });
  }
  await db.from("activity").insert({ issue_id: id, user_id: ctx.userId, kind: "pr_linked", payload: { pr_url: pr.url, pr_number: pr.number, repo: pr.repo, ...(preview.url ? { preview_url: preview.url } : {}) } });
  return NextResponse.json({ ok: true, id: row.id, url: pr.url });
}
