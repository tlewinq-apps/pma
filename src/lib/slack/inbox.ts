/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase nested selects are untyped */
// Feedback in from Slack: a message posted in an app's inbox channel, or any message sent with the Send shortcut.
// It becomes a `slack` source on the normal pipeline, and the sender hears back where it was filed.
import { serviceDb } from "@/lib/db/server";
import { enqueueSource } from "@/lib/ingest/enqueue";
import { runSource } from "@/lib/pipeline/deps";
import type { IssueType } from "@/lib/types";
import { ephemeral, respond, slackApi, slackTeam } from "./api";
import { slackToPlain, tsToIso } from "./events";
import { permalink } from "./ids";
import { filedText } from "./messages";
import { resolveSlackUser } from "./users";
import { connectionFor, getPost, post, putPost, refreshBoardFor, syncIssueToSlack, update } from "./sync";
import { inSlackFor } from "./tenant";
import { brand } from "./context";

export type ReplyTo = { kind: "thread"; channel: string; ts: string } | { kind: "ephemeral"; responseUrl: string };

const names = new Map<string, string>();
async function channelLabel(channel: string, known?: string): Promise<string> {
  if (known) names.set(channel, known);
  if (!names.has(channel)) {
    try { names.set(channel, (await slackApi<{ channel: { name: string } }>("conversations.info", { channel })).channel.name); } catch { names.set(channel, channel); }
  }
  return `Slack #${names.get(channel)}`;
}

/** Queues one Slack message as a source. Dedupes on channel + ts, so a retried event or a second shortcut is a duplicate. */
export async function ingestSlackMessage(m: { projectId: string; channel: string; channelName?: string; ts: string; user: string; text: string; via: "inbox" | "shortcut" | "reply"; threadTs?: string }) {
  const person = await resolveSlackUser(m.user, m.projectId);
  const input = {
    kind: "slack", raw_text: slackToPlain(m.text), author: person.name, channel: await channelLabel(m.channel, m.channelName),
    occurred_at: tsToIso(m.ts), metadata: { slack: { channel: m.channel, ts: m.ts, user: m.user, via: m.via, ...(m.threadTs ? { reply_to: m.threadTs } : {}) } }, hashKey: `slack:${m.channel}:${m.ts}`,
  };
  try {
    return await enqueueSource(m.projectId, input);
  } catch (e) {
    // Two deliveries racing on the unique hash: the second finds the first's row.
    if (/duplicate key/i.test((e as Error).message)) return enqueueSource(m.projectId, input);
    throw e;
  }
}

/** Where a source's feedback landed: one entry per issue, with a link to its card thread. */
async function filedIssues(sourceId: string): Promise<Parameters<typeof filedText>[0]["issues"]> {
  const db = serviceDb();
  const { data: units } = await db.from("feedback_units").select("issue_id").eq("source_id", sourceId).not("issue_id", "is", null);
  const ids = [...new Set((units ?? []).map((u) => u.issue_id as string))];
  if (!ids.length) return [];
  const [{ data: issues }, { data: added }, { data: threads }] = await Promise.all([
    db.from("issues").select("id, title, type, people_count").in("id", ids),
    db.from("activity").select("issue_id, payload").eq("kind", "feedback_added").in("issue_id", ids),
    db.from("slack_threads").select("issue_id, channel_id, ts").in("issue_id", ids).not("ts", "is", null),
  ]);
  const team = await slackTeam().catch(() => null);
  const created = new Set((added ?? []).filter((a: any) => a.payload?.source_id === sourceId && a.payload?.created).map((a) => a.issue_id as string));
  const link = new Map((threads ?? []).map((t) => [t.issue_id as string, team ? permalink(team.url, t.channel_id, t.ts) : null]));
  return (issues ?? []).map((i) => ({ type: i.type as IssueType, title: i.title, link: link.get(i.id) ?? null, created: created.has(i.id), people: Number(i.people_count) }));
}

/**
 * Tells the sender where their feedback went: edits the "Reading this now" note in the thread, or replies privately.
 * Runs in the workspace the message came from (withSlack).
 */
export async function replyFiled(sourceId: string, reply: ReplyTo, status: "done" | "failed" | "duplicate"): Promise<void> {
  try {
    const text = filedText({ status, issues: status === "failed" ? [] : await filedIssues(sourceId) });
    if (reply.kind === "ephemeral") return respond(reply.responseUrl, ephemeral(text));
    const db = serviceDb();
    const { data: src } = await db.from("sources").select("project_id").eq("id", sourceId).maybeSingle();
    if (!src) return;
    const ref = `source:${sourceId}`;
    const placeholder = await getPost(db, src.project_id, ref);
    if (placeholder) {
      try { await update(placeholder.channel_id, placeholder.ts, { text }); return; } catch { /* deleted: post a new one */ }
    }
    const { ts } = await post(reply.channel, reply.ts, { text });
    await putPost(db, src.project_id, ref, reply.channel, ts);
  } catch (e) {
    console.error("[slack] filed reply failed", sourceId, e);
  }
}

/**
 * The pipeline's onFiled hook for every source (deps.ts): post or refresh the touched cards right after clustering,
 * then, for a message posted in the app's inbox, answer in its thread. Runs again when the cron retries a failed source.
 * The thread comes from the source row, which members can write, so the answer only goes to the app's own inbox, in the
 * app's own workspace.
 */
export async function slackOnFiled(sourceId: string, issueIds: string[]): Promise<void> {
  for (const id of issueIds) await syncIssueToSlack(id, { board: false });
  const { data: src } = await serviceDb().from("sources").select("project_id, kind, metadata").eq("id", sourceId).maybeSingle();
  const s = (src?.metadata as { slack?: { channel?: string; ts?: string; via?: string } } | null)?.slack;
  if (src?.kind !== "slack" || s?.via !== "inbox" || !s.channel || !s.ts) return;
  await inSlackFor(src.project_id as string, async () => {
    const conn = await connectionFor(src.project_id as string);
    if (conn?.channels.inbox?.id !== s.channel) return;
    await replyFiled(sourceId, { kind: "thread", channel: s.channel!, ts: s.ts! }, "done");
  });
}

/** After scoring and lane automation: bring the touched issues' cards and the board up to date (pipeline onProcessed). */
export async function slackOnProcessed(sourceId: string, issueIds: string[]): Promise<void> {
  for (const id of issueIds) await syncIssueToSlack(id, { board: false });
  if (!issueIds.length) return;
  const { data: src } = await serviceDb().from("sources").select("project_id").eq("id", sourceId).maybeSingle();
  if (src) await refreshBoardFor(src.project_id as string);
}

/** Runs a freshly queued Slack source end to end and keeps the sender posted. Never throws. */
export async function runFeedbackFlow(sourceId: string, reply: ReplyTo): Promise<void> {
  const db = serviceDb();
  try {
    if (reply.kind === "thread") {
      const { ts } = await post(reply.channel, reply.ts, { text: "Reading this now." });
      const { data: src } = await db.from("sources").select("project_id").eq("id", sourceId).single();
      await putPost(db, src!.project_id as string, `source:${sourceId}`, reply.channel, ts);
    } else {
      await respond(reply.responseUrl, ephemeral(`Sending this to ${brand()}. You'll hear where it lands.`));
    }
    // The shortcut's private reply needs its response_url, which only this closure has.
    const onFiled = reply.kind === "ephemeral"
      ? async (sid: string, ids: string[]) => { await slackOnFiled(sid, ids); await replyFiled(sid, reply, "done"); }
      : slackOnFiled;
    await runSource(sourceId, { onFiled });
    const { data: src } = await db.from("sources").select("status").eq("id", sourceId).single();
    if (src?.status !== "done") { await replyFiled(sourceId, reply, "failed"); return; }
    // The "Filed" note went out before scoring; rewrite it in place now that people counts are final. The cards and
    // the board were brought up to date by the pipeline's onProcessed hook (deps.ts).
    if (reply.kind === "thread") await replyFiled(sourceId, reply, "done");
  } catch (e) {
    console.error("[slack] feedback flow failed", sourceId, e);
    await replyFiled(sourceId, reply, "failed");
  }
}
