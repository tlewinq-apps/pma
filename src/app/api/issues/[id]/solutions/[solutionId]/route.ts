import { NextResponse, after } from "next/server";
import { appForIssue } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { userDb } from "@/lib/db/server";
import { editProposal, nameProposalLater, removeProposal, type WriteResult } from "@/lib/actions/proposals";
import { slackSyncLater } from "@/lib/slack/hooks";

type Params = { params: Promise<{ id: string; solutionId: string }> };

function reply(id: string, r: WriteResult) {
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  slackSyncLater(id);
  if (r.rename) { const rename = r.rename; after(() => nameProposalLater(id, r.id, rename)); }
  return NextResponse.json({ ok: true });
}

/** Edit a proposal, or `{ restore: true }` to put PMA's version back. The first edit keeps that version. */
export async function PATCH(req: Request, { params }: Params) {
  const { id, solutionId } = await params;
  const ctx = await appForIssue(id);
  if (!ctx) return notFoundResponse();
  return reply(id, await editProposal(await userDb(), id, solutionId, ctx.userId, await req.json().catch(() => null))); // RLS-scoped
}

/** Remove a proposal your team wrote. PMA's own proposals stay (edit or restore them instead). */
export async function DELETE(_req: Request, { params }: Params) {
  const { id, solutionId } = await params;
  const ctx = await appForIssue(id);
  if (!ctx) return notFoundResponse();
  return reply(id, await removeProposal(await userDb(), id, solutionId, ctx.userId));
}
