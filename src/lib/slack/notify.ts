/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase nested-select results are untyped; mapped by hand below */
import { serviceDb } from "@/lib/db/server";
import { env, slackEnabled } from "@/lib/env";
import { quickWinBlocks } from "./blocks";

export async function postSlack(webhook: string, blocks: object[], text: string) {
  const r = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, blocks }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`Slack ${r.status}`);
}

/** Best-effort: a Slack failure is logged to activity and never propagates (it must not block the draft). */
export async function notifyQuickWin(issueId: string): Promise<void> {
  const db = serviceDb();
  // The Slack app's card replaces this alert for an app that has Slack set up.
  const { data: own } = await db.from("issues").select("project_id").eq("id", issueId).maybeSingle();
  if (slackEnabled() && own && (await (await import("./ownership")).slackIsMine(own.project_id as string))) return;
  try {
    const { data: i } = await db.from("issues").select("id,title,type,importance,people_count,projects(slack_webhook_url),feedback_units(quote,sources(author)),issue_screens(position,screens(scene,title))").eq("id", issueId).single();
    const hook = (i as any)?.projects?.slack_webhook_url as string | null;
    if (!i || !hook) return;
    const u = (i as any).feedback_units?.[0];
    const s = [...((i as any).issue_screens ?? [])].sort((a: any, b: any) => a.position - b.position);
    const first = s[0]?.screens?.scene as string | undefined;
    const last = s.at(-1)?.screens?.title as string | undefined;
    await postSlack(hook, quickWinBlocks({
      title: i.title, type: i.type, importance: i.importance ?? 0, people: Number(i.people_count),
      quote: u?.quote ?? "", author: u?.sources?.author ?? null,
      flow: first && last ? `${first} › ${last}` : null,
      url: `${env.appUrl()}/issues/${i.id}`,
    }), `Quick win: ${i.title}`);
    await db.from("activity").insert({ issue_id: issueId, kind: "slack_sent", payload: {} });
  } catch (e) {
    try { await db.from("activity").insert({ issue_id: issueId, kind: "slack_failed", payload: { error: e instanceof Error ? e.message : String(e) } }); } catch { /* ignore */ }
  }
}
