// See it live: the preview site and checks of the issue's open pull requests (lib/github/live), for anyone in the
// company who can open the issue. Outsiders get a 404 before anything is read; the demo app and an app without a
// repository have nothing to show. The issue page asks on load, then again while a preview or a check is still running.
import { NextResponse } from "next/server";
import { appForIssue } from "@/lib/db/app";
import { userDb } from "@/lib/db/server";
import { notFoundResponse } from "@/lib/api/guards";
import { liveFor, NO_LIVE } from "@/lib/github/live";

/** The newest open pull requests a page shows; more than this is rare and would only slow the read. */
const MAX_PRS = 3;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await appForIssue(id);
  if (!ctx) return notFoundResponse();
  const noStore = { headers: { "cache-control": "no-store" } };
  if (ctx.project.kind === "demo" || !ctx.project.repo_full_name) return NextResponse.json(NO_LIVE, noStore);
  const { data } = await (await userDb()).from("pull_request_links").select("repo, number, url, created_at")
    .eq("issue_id", id).eq("state", "open").order("created_at", { ascending: false }).limit(MAX_PRS); // RLS-scoped
  const prs = (data ?? []).map((l) => ({ repo: String(l.repo), number: Number(l.number), url: String(l.url) }));
  try {
    return NextResponse.json(await liveFor(ctx.org.id, prs), noStore);
  } catch (e) {
    console.error("[live] GitHub read failed", id, (e as Error).message);
    return NextResponse.json({ error: "GitHub didn't answer. PMA tries again in a moment." }, { status: 502 });
  }
}
