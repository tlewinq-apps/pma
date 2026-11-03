// Disconnect GitHub: PMA stops reading the company's repositories with the installation (nothing secret is stored, so
// there is nothing to forget). The app stays installed on GitHub until someone removes it there. Owners and admins only.
import { NextResponse } from "next/server";
import { appById } from "@/lib/db/app";
import { adminOnly, notFoundResponse } from "@/lib/api/guards";
import { serviceDb } from "@/lib/db/server";
import { audit, findConnection } from "@/lib/connections/store";
import { forgetGithubTokens } from "@/lib/github/app";

export async function DELETE(_req: Request, { params }: { params: Promise<{ appId: string }> }) {
  const ctx = await appById((await params).appId);
  if (!ctx) return notFoundResponse();
  const denied = adminOnly(ctx);
  if (denied) return denied;
  const conn = await findConnection("github", { orgId: ctx.org.id, projectId: null });
  if (conn) {
    const { error } = await serviceDb().from("connections").update({ status: "disconnected", status_reason: null, external_id: null, updated_at: new Date().toISOString() }).eq("id", conn.id);
    if (error) return NextResponse.json({ error: "Couldn't disconnect GitHub. Try again." }, { status: 500 });
    if (conn.external_id) forgetGithubTokens(conn.external_id);
    await audit({ orgId: ctx.org.id, projectId: ctx.project.id, actorId: ctx.userId, action: "connection.disconnected", target: "github" });
  }
  return NextResponse.json({ ok: true });
}
