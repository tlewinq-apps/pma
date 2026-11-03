import { NextResponse, after } from "next/server";
import { appForIssue } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { userDb } from "@/lib/db/server";
import { addProposal, nameProposalLater } from "@/lib/actions/proposals";
import { slackSyncLater } from "@/lib/slack/hooks";

/** Write your own: a team member's proposal, ranked after the existing ones. Mock it up drafts it like any other. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await appForIssue(id);
  if (!ctx) return notFoundResponse();
  const r = await addProposal(await userDb(), id, ctx.userId, await req.json().catch(() => null)); // RLS-scoped
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  slackSyncLater(id);
  if (r.rename) { const rename = r.rename; after(() => nameProposalLater(id, r.id, rename)); }
  return NextResponse.json({ ok: true, id: r.id });
}
