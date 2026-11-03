// Who may link a pull request to an issue, and the issue it is linked to: an owner or admin of the company, or the
// issue's owner (whoever took it on). Outsiders get a 404 before anything else is known, like every issue route; the
// demo app has no pull requests to link. Writes then go through the service role (pull_request_links has no write
// grants for signed-in users, migration 0040).
import { NextResponse } from "next/server";
import { appForIssue, hasRole, type AppCtx } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { userDb } from "@/lib/db/server";
import { LINK_FORBIDDEN } from "@/lib/handoff/build";

export type LinkIssue = { id: string; status: string; owner_id: string | null };

export const LINK_AFTER_APPROVAL = "Pull requests are linked once the mock-up is approved and the issue is ready to build.";
export const LINK_SHIPPED = "This issue has shipped, so its pull requests stay as they are.";
export const LINK_DISMISSED = "This issue was dismissed.";

/**
 * Linking, editing and removing pull requests happen only while the issue is Ready to build: not before the mock-up is
 * approved (that would skip the hand-off), and not once it has shipped (the links are the record of what shipped).
 * A dismissed issue says so, as it always has; any other status says to approve the mock-up first.
 */
export function notReadyToLink(issue: LinkIssue): NextResponse | null {
  if (issue.status === "ready_to_build") return null;
  const error = issue.status === "shipped" ? LINK_SHIPPED : issue.status === "dismissed" ? LINK_DISMISSED : LINK_AFTER_APPROVAL;
  return NextResponse.json({ error }, { status: 409 });
}

export async function linkAccess(issueId: string): Promise<{ ctx: AppCtx; issue: LinkIssue } | { res: NextResponse }> {
  const ctx = await appForIssue(issueId);
  if (!ctx) return { res: notFoundResponse() };
  const { data } = await (await userDb()).from("issues").select("id, status, owner_id").eq("id", issueId).maybeSingle(); // RLS-scoped
  if (!data) return { res: notFoundResponse() };
  const issue = data as LinkIssue;
  if (ctx.project.kind === "demo") return { res: NextResponse.json({ error: "The demo app ships when its mock-up is approved, so it has no pull requests to link." }, { status: 409 }) };
  if (!hasRole(ctx, ["owner", "admin"]) && issue.owner_id !== ctx.userId) return { res: NextResponse.json({ error: LINK_FORBIDDEN }, { status: 403 }) };
  return { ctx, issue };
}
