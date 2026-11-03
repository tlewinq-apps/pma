// The PMA GitHub App's webhook (separate from the demo repository's PR webhook one level up). Signed with
// GITHUB_APP_WEBHOOK_SECRET.
// - installation: an uninstall or suspension revokes the company's GitHub connection; accepted permissions are kept,
//   so Build it knows when it can write.
// - installation_repositories: repositories taken out mark the connection Needs attention when an app reads one.
// - pull_request: a merge ships its issue, a close or reopen updates the link, and a "PMA: <short>" line links it
//   (lib/build/pullEvents.ts), each only for the companies holding this installation.
// Everything else is acknowledged and ignored.
import { NextResponse } from "next/server";
import { verifyGithubSignature } from "@/lib/github/verify";
import { forgetGithubTokens } from "@/lib/github/app";
import { githubPermissionsChanged, githubReposRemoved, revokeGithubInstallation } from "@/lib/github/install";
import { onPullRequest } from "@/lib/build/pullEvents";
import { slackSyncLater } from "@/lib/slack/hooks";

type Payload = {
  action?: string; installation?: { id?: number; permissions?: Record<string, string> }; repositories_removed?: { full_name?: string }[];
  repository?: { full_name?: string }; pull_request?: { number?: number; merged?: boolean; body?: string | null };
};

export async function POST(req: Request) {
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 404 });
  const raw = await req.text();
  if (!verifyGithubSignature(secret, raw, req.headers.get("x-hub-signature-256"))) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  let p: Payload;
  try { p = JSON.parse(raw) as Payload; } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const id = p.installation?.id ? String(p.installation.id) : null;
  if (!id) return NextResponse.json({ ignored: true });
  const event = req.headers.get("x-github-event");
  if (event === "installation" && (p.action === "deleted" || p.action === "suspend")) {
    await revokeGithubInstallation(id, p.action === "deleted" ? "The PMA app was uninstalled on GitHub. Connect with GitHub again." : "The PMA app was suspended on GitHub.");
    return NextResponse.json({ ok: true });
  }
  if (event === "installation" && (p.action === "new_permissions_accepted" || p.action === "created" || p.action === "unsuspend")) {
    forgetGithubTokens(id); // a token keeps the permissions it was minted with: the next one carries the new ones
    await githubPermissionsChanged(id, p.installation?.permissions);
    return NextResponse.json({ ok: true });
  }
  if (event === "pull_request" && p.pull_request?.number && p.repository?.full_name && p.action) {
    const r = await onPullRequest({
      action: p.action, installationId: id, repo: p.repository.full_name, number: p.pull_request.number,
      merged: !!p.pull_request.merged, body: p.pull_request.body ?? "",
    });
    for (const issueId of [...r.shipped, ...r.linked]) slackSyncLater(issueId);
    return NextResponse.json({ ok: true, ...r });
  }
  if (event === "installation_repositories" && p.action === "removed") {
    await githubReposRemoved(id, (p.repositories_removed ?? []).map((r) => r.full_name).filter((r): r is string => typeof r === "string"));
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ignored: true });
}
