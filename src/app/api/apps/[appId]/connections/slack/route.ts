// Disconnect the company's Slack workspace: PMA is uninstalled from it (best effort) and its token forgotten. The
// apps' channel choices stay, so connecting the same workspace again picks up where it left off. Owners and admins only.
import { NextResponse } from "next/server";
import { appById } from "@/lib/db/app";
import { adminOnly, notFoundResponse } from "@/lib/api/guards";
import { disconnectSlack } from "@/lib/slack/install";

export async function DELETE(_req: Request, { params }: { params: Promise<{ appId: string }> }) {
  const ctx = await appById((await params).appId);
  if (!ctx) return notFoundResponse();
  const denied = adminOnly(ctx);
  if (denied) return denied;
  await disconnectSlack({ orgId: ctx.org.id, projectId: ctx.project.id, userId: ctx.userId });
  return NextResponse.json({ ok: true });
}
