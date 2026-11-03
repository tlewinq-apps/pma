import { NextResponse } from "next/server";
import { serviceDb } from "@/lib/db/server";
import { approximateFrames, consumeCallbackToken, parseCallbackBody, validFrameFiles, validShotPath, type Shot } from "@/lib/drafts/callback";
import { postSlack } from "@/lib/slack/notify";
import { draftReadyBlocks } from "@/lib/slack/blocks";
import { marverBranchUrl } from "@/lib/queries/issueHelpers";
import { env, slackEnabled } from "@/lib/env";
import { slackSyncLater } from "@/lib/slack/hooks";
import { mockPrUrl } from "@/lib/drafts/mockRunner";
import { isApproximate } from "@/lib/drafts/codeMockup";

export const maxDuration = 60;
export async function POST(req: Request) {
  const raw = (await req.json().catch(() => null)) as { draft_id?: unknown } | null;
  const db = serviceDb();
  // Load the draft first: a mock-runner draft's "pull request" is a page in this app, not on github.com.
  const { data: d } = typeof raw?.draft_id === "string"
    ? await db.from("drafts").select("id,issue_id,branch,backend,callback_token,callback_used_at,issues(projects(kind))").eq("id", raw.draft_id).maybeSingle()
    : { data: null };
  const parsed = parseCallbackBody(raw, { mockPrefix: d?.backend === "mock" ? mockPrUrl(env.appUrl(), "") : undefined });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const body = parsed.value;
  if (!d) return NextResponse.json({ error: "unknown draft" }, { status: 404 });
  const check = consumeCallbackToken(d, body.token);
  if (check === "invalid") return NextResponse.json({ error: "invalid token" }, { status: 401 });
  if (check === "replayed") return NextResponse.json({ error: "already used" }, { status: 409 });
  // Atomic claim: only one concurrent request can flip callback_used_at from null.
  const { data: claimed } = await db.from("drafts").update({ callback_used_at: new Date().toISOString() }).eq("id", d.id).is("callback_used_at", null).select("id");
  if (!claimed?.length) return NextResponse.json({ error: "already used" }, { status: 409 });
  // A customer app's mock-runner draft is an approximate mock-up: its activity links to no pull request or run log.
  const kind = (d as { issues?: { projects?: { kind?: string } | null } | null }).issues?.projects?.kind;
  const approximate = !!kind && isApproximate(d, { kind });

  if (body.status === "failed") {
    await db.from("drafts").update({ status: "failed", log_url: body.log_url ?? null }).eq("id", d.id);
    await db.from("issues").update({ status: "new" }).eq("id", d.issue_id);
    await db.from("activity").insert({ issue_id: d.issue_id, kind: "draft_failed", payload: approximate ? { approximate: true, error: typeof body.error === "string" ? body.error.slice(0, 200) : null } : { log_url: body.log_url } });
    slackSyncLater(d.issue_id);
    return NextResponse.json({ ok: true });
  }

  // Screenshots were PUT straight to Storage via signed URLs; accept only this draft's slot paths.
  const toImages = (shots: Shot[] = []) => (Array.isArray(shots) ? shots : []).slice(0, 12)
    .filter((s) => s && typeof s.frame_id === "string" && validShotPath(s.path, d.issue_id, d.id))
    .map((s) => ({ frame_id: s.frame_id, url: db.storage.from("shots").getPublicUrl(s.path).data.publicUrl }));
  const before = toImages(body.before); const after = toImages(body.after);
  await db.from("drafts").update({
    status: "ready", pr_url: body.pr_url, pr_number: body.pr_number, pr_state: "open",
    marver_paths: Array.isArray(body.marver_paths) ? body.marver_paths.filter((p) => typeof p === "string") : [],
    // An approximate mock-up has no frame files: its entry carries only the line on what changed, for Copy task.
    before_images: before, after_images: after, frames: approximate ? approximateFrames(body.changed, after, body.frame_source) : validFrameFiles(body.frames),
  }).eq("id", d.id);
  await db.from("issues").update({ status: "draft_ready" }).eq("id", d.issue_id);
  await db.from("activity").insert({ issue_id: d.issue_id, kind: "draft_ready", payload: approximate ? { approximate: true } : { pr_url: body.pr_url } });
  // The Slack app posts the mockup into the issue's thread; without it, the legacy webhook alerts quick wins.
  if (slackEnabled()) { slackSyncLater(d.issue_id); return NextResponse.json({ ok: true }); }
  // Slack follow-up for quick wins. Best-effort: must never fail the callback.
  try {
    const { data: iss } = await db.from("issues").select("id,lane,title,type,importance,projects(slack_webhook_url,repo_full_name,design_path)").eq("id", d.issue_id).single();
    const p = (iss as { projects?: { slack_webhook_url?: string | null; repo_full_name?: string | null; design_path?: string | null } | null } | null)?.projects;
    if (iss?.lane === "quick_win" && p?.slack_webhook_url && body.pr_url) {
      await postSlack(p.slack_webhook_url, draftReadyBlocks({
        title: iss.title, type: iss.type, importance: iss.importance ?? 0, prUrl: body.pr_url,
        marverUrl: marverBranchUrl(p.repo_full_name, d.branch, p.design_path),
        pmaUrl: `${env.appUrl()}/issues/${iss.id}`,
        beforeUrl: before[0]?.url, afterUrl: after[0]?.url,
      }), `Draft ready: ${iss.title}`);
    }
  } catch { /* ignore Slack/lookup errors */ }
  return NextResponse.json({ ok: true });
}
