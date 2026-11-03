// The repositories the company's GitHub installation was given, for the repository picker. Owners and admins only.
import { NextResponse } from "next/server";
import { appById } from "@/lib/db/app";
import { adminOnly, notFoundResponse } from "@/lib/api/guards";
import { findConnection } from "@/lib/connections/store";
import { GithubAppError, installationRepos } from "@/lib/github/app";

export async function GET(_req: Request, { params }: { params: Promise<{ appId: string }> }) {
  const ctx = await appById((await params).appId);
  if (!ctx) return notFoundResponse();
  const denied = adminOnly(ctx);
  if (denied) return denied;
  const conn = await findConnection("github", { orgId: ctx.org.id, projectId: null });
  if (!conn?.external_id || (conn.status !== "ok" && conn.status !== "broken")) return NextResponse.json({ error: "Connect with GitHub first." }, { status: 409 });
  try {
    return NextResponse.json({ repos: await installationRepos(conn.external_id) });
  } catch (e) {
    console.error("[github] listing repositories failed", (e as Error).message);
    const gone = e instanceof GithubAppError && (e.status === 401 || e.status === 403 || e.status === 404);
    return NextResponse.json({ error: gone ? "PMA can't reach your GitHub installation any more. Connect with GitHub again." : "GitHub didn't answer. Try again in a minute." }, { status: 502 });
  }
}
