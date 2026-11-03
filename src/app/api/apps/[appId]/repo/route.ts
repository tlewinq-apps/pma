// Connect (POST) or disconnect (DELETE) the app's repository; owners and admins only. Connecting reads the repository
// first (a dev checkout under .local-repos, a public GitHub repo, or a private one the company's PMA GitHub App
// installation was given), so only a repository PMA can read is ever saved. repo_full_name has no UPDATE grant for signed-in users (0018), so the write goes through the service
// role, and only after the membership and role checks above it. The demo app's repository is refused: it decides where
// the deployment's GitHub token dispatches and merges (drafts/demo.ts mayUseDeploymentToken), so PMA manages it.
import { NextResponse } from "next/server";
import { appById } from "@/lib/db/app";
import { adminOnly, notFoundResponse } from "@/lib/api/guards";
import type { AppCtx } from "@/lib/db/app";
import { serviceDb } from "@/lib/db/server";
import { isBranchName } from "@/lib/settings";
import { connectRepoProblem, openRepo, unreadableReason, REPO_MESSAGES, RepoFetchError, RepoPathError, type RepoSnapshot } from "@/lib/repo/snapshot";

// Reading a large public repository downloads and unpacks its tarball (capped at 80 MB and 20,000 files).
export const maxDuration = 60;

const SAVE_FAILED = "Couldn't save the repository. Try again.";
const DEMO_REPO_MANAGED = "The demo app's repository is managed by PMA.";
/** 409 for the demo app, after the membership and role checks (an outsider still gets 404, a member 403). */
const demoRefused = (ctx: AppCtx) => (ctx.project.kind === "demo" ? NextResponse.json({ error: DEMO_REPO_MANAGED }, { status: 409 }) : null);
const bad = (error: string, code?: string) => NextResponse.json(code ? { error, code } : { error }, { status: 400 });

export async function POST(req: Request, { params }: { params: Promise<{ appId: string }> }) {
  const ctx = await appById((await params).appId);
  if (!ctx) return notFoundResponse();
  const denied = adminOnly(ctx) ?? demoRefused(ctx);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as { repo?: unknown; branch?: unknown } | null;
  const repo = typeof body?.repo === "string" ? body.repo.trim() : "";
  if (connectRepoProblem(repo)) return bad(REPO_MESSAGES.repo_invalid, "repo_invalid");
  const rawBranch = body?.branch;
  const branch = typeof rawBranch === "string" ? rawBranch.trim() || null : rawBranch == null ? null : rawBranch;
  if (branch !== null && !isBranchName(branch)) return bad(REPO_MESSAGES.branch_invalid, "branch_invalid");

  let snap: RepoSnapshot | null;
  try {
    snap = await openRepo({ repo_full_name: repo, watched_branch: branch, org_id: ctx.org.id });
    if (!snap) {
      const why = await unreadableReason(repo, { orgId: ctx.org.id });
      return bad(REPO_MESSAGES[why], why);
    }
  } catch (e) {
    if (e instanceof RepoFetchError) return NextResponse.json({ error: e.message }, { status: 502 });
    if (e instanceof RepoPathError) return bad(e.message, "repo_invalid");
    throw e;
  }

  const { error } = await serviceDb().from("projects").update({ repo_full_name: repo, watched_branch: snap.ref }).eq("id", ctx.project.id);
  if (error) return NextResponse.json({ error: SAVE_FAILED }, { status: 500 });
  return NextResponse.json({ ok: true, repo, ref: snap.ref, files: snap.files().length });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ appId: string }> }) {
  const ctx = await appById((await params).appId);
  if (!ctx) return notFoundResponse();
  const denied = adminOnly(ctx) ?? demoRefused(ctx);
  if (denied) return denied;
  const { error } = await serviceDb().from("projects").update({ repo_full_name: null }).eq("id", ctx.project.id);
  return error ? NextResponse.json({ error: "Couldn't disconnect the repository. Try again." }, { status: 500 }) : NextResponse.json({ ok: true });
}
