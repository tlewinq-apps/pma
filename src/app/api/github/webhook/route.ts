import { NextResponse, after } from "next/server";
import { slackSyncLater, slackSyncNow } from "@/lib/slack/hooks";
import { serviceDb } from "@/lib/db/server";
import { env } from "@/lib/env";
import { verifyGithubSignature } from "@/lib/github/verify";
import { prStateToStatus } from "@/lib/drafts/callback";
import { isNewestDraft } from "@/lib/drafts/inflight";
import { draftForPullRequest } from "@/lib/github/prDraft";

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyGithubSignature(env.githubWebhookSecret(), raw, req.headers.get("x-hub-signature-256"))) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  const event = req.headers.get("x-github-event");
  let p: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { p = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  if (event !== "pull_request" && event !== "pull_request_review") return NextResponse.json({ ignored: true });
  const pr = p.pull_request;
  if (!pr?.head?.ref?.startsWith("pma/")) return NextResponse.json({ ignored: true });
  // Reject fork PRs and events from any repo other than the one this event was delivered for.
  const repoName = p.repository?.full_name;
  if (typeof repoName !== "string" || pr.head?.repo?.full_name?.toLowerCase() !== repoName.toLowerCase()) return NextResponse.json({ ignored: true });
  const status = prStateToStatus(p.action, !!pr.merged, p.review?.state);
  if (!status) return NextResponse.json({ ignored: true });
  const db = serviceDb();
  // The newest draft on this branch among apps connected to this exact repo (filtered in the query, see prDraft.ts).
  const d = await draftForPullRequest(db, pr.head.ref, repoName);
  if (!d) return NextResponse.json({ ignored: true });
  await db.from("drafts").update({ pr_state: pr.merged ? "merged" : pr.state, pr_url: pr.html_url, pr_number: pr.number }).eq("id", d.id);
  // A superseded draft's PR (closed after a re-draft, say) must not overwrite the issue status set by the newer draft.
  const { data: siblings, error: sibErr } = await db.from("drafts").select("id,created_at").eq("issue_id", d.issue_id);
  if (sibErr) return NextResponse.json({ error: sibErr.message }, { status: 500 });
  if (!isNewestDraft(d.id, siblings ?? [])) return NextResponse.json({ ok: true, superseded: true });
  await db.from("issues").update({ status }).eq("id", d.issue_id);
  await db.from("activity").insert({ issue_id: d.issue_id, kind: "pr_event", payload: { action: p.action, to: status, by: p.sender?.login } });
  if (status === "shipped") after(async () => { await (await import("@/lib/slack/reporters")).tellReporters(d.issue_id); await slackSyncNow(d.issue_id); });
  else slackSyncLater(d.issue_id);
  return NextResponse.json({ ok: true });
}
