import { NextResponse } from "next/server";
import { appForIssue } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { approveAndMerge } from "@/lib/actions/approve";
import { slackSyncLater } from "@/lib/slack/hooks";
import { parseBuildMode } from "@/lib/handoff/build";
export const maxDuration = 60;

/**
 * Approve and merge the issue's latest draft (GitHub PR, or a demo draft). For a customer app's approximate mock-up the
 * optional body `{ build, branch }` says how it should be built (a pull request starts Build it; "branch" names the
 * branch); without it the app's default applies.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await appForIssue(id);
  if (!ctx) return notFoundResponse();
  const body = (await req.json().catch(() => null)) as { build?: unknown; branch?: unknown } | null;
  const build = body?.build == null ? undefined : parseBuildMode(body.build);
  if (build === null) return NextResponse.json({ error: "Pick how this should be built." }, { status: 400 });
  const branch = typeof body?.branch === "string" ? body.branch : null;
  const r = await approveAndMerge(id, ctx.userId, { ...(build ? { build } : {}), branch, origin: new URL(req.url).origin });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  slackSyncLater(id);
  return NextResponse.json({ ok: true });
}
