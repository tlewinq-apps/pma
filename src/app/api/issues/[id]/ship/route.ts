// Mark as shipped (lib/actions/ship.ts): owners and admins, on a customer issue that is Ready to build with a linked
// pull request. Stands in for GitHub's "merged" until the PMA GitHub App's webhook reports it.
import { NextResponse } from "next/server";
import { appForIssue, hasRole } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { markShipped } from "@/lib/actions/ship";
import { SHIP_FORBIDDEN } from "@/lib/handoff/build";
import { slackSyncLater } from "@/lib/slack/hooks";

export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await appForIssue(id);
  if (!ctx) return notFoundResponse();
  if (!hasRole(ctx, ["owner", "admin"])) return NextResponse.json({ error: SHIP_FORBIDDEN }, { status: 403 });
  const r = await markShipped(id, ctx.userId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  slackSyncLater(id);
  return NextResponse.json({ ok: true });
}
