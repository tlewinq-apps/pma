// Build it, again: starts a new attempt for an issue that is Ready to build (after one failed, or to build it another
// way). Same people as linking a pull request (an owner, an admin or the issue's owner), only while the company's
// GitHub installation can write, and not while another attempt is still running.
import { NextResponse } from "next/server";
import { serviceDb } from "@/lib/db/server";
import { linkAccess, notReadyToLink } from "@/lib/api/prLinks";
import { BUILD_UNAVAILABLE, buildModeAvailable, parseBuildMode } from "@/lib/handoff/build";
import { isBranchName } from "@/lib/settings";
import { buildCaps, startBuild } from "@/lib/build/start";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await linkAccess(id);
  if ("res" in access) return access.res;
  const { ctx, issue } = access;
  const closed = notReadyToLink(issue);
  if (closed) return closed;
  if (ctx.project.kind === "demo") return NextResponse.json({ error: "The demo app doesn't build pull requests." }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { mode?: unknown; branch?: unknown } | null;
  const mode = parseBuildMode(body?.mode);
  if (mode !== "new_pr" && mode !== "branch") return NextResponse.json({ error: "Pick New pull request or Add to an existing branch." }, { status: 400 });
  const branch = mode === "branch" && typeof body?.branch === "string" ? body.branch.trim() : null;
  if (mode === "branch" && (!branch || !isBranchName(branch))) return NextResponse.json({ error: "Name the branch to add the change to.", field: "branch" }, { status: 400 });
  if (!buildModeAvailable(mode, await buildCaps(ctx.org.id))) return NextResponse.json({ error: BUILD_UNAVAILABLE }, { status: 409 });
  const db = serviceDb();
  const { data: busy } = await db.from("builds").select("id").eq("issue_id", id).in("status", ["queued", "running"]).limit(1);
  if (busy?.length) return NextResponse.json({ error: "PMA is already building this one. Wait for it to finish." }, { status: 409 });
  const buildId = await startBuild({ issueId: id, projectId: ctx.project.id, mode, branch, userId: ctx.userId, origin: new URL(req.url).origin }, db);
  return NextResponse.json({ ok: true, id: buildId });
}
