/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase nested selects are untyped */
// Replies in the reporters' original Slack threads: "this is fixed" when an issue ships, and follow-up questions.
// Each reply is claimed in alert_log first, so a retried approve or a second click never posts twice.
// The thread to reply in comes from sources.metadata and the questions from issues.followups, which members can write.
// So replies only ever go out in the issue's own app's workspace (inSlackFor), to threads of that app's own sources,
// and a reply in a thread is matched only to the sources of the app whose inbox it is in.
import { serviceDb } from "@/lib/db/server";
import { env, slackEnabled } from "@/lib/env";
import { alertKey } from "@/lib/alerts/rules";
import { claimAlert } from "@/lib/alerts/send";
import { followupAskText, reportersToTell, shippedReplyText, type ReporterRow, type SlackReporter } from "@/lib/reporters";
import type { Followups } from "@/lib/followups";
import { SlackError, slackApi } from "./api";
import { inSlackFor } from "./tenant";

async function projectOfIssue(issueId: string): Promise<string | null> {
  const { data } = await serviceDb().from("issues").select("project_id").eq("id", issueId).maybeSingle();
  return (data?.project_id as string | undefined) ?? null;
}

/** The issue's Slack reporters, or null when it's missing or its app has no Slack channels. Runs in the app's workspace. */
async function reportersOf(issueId: string) {
  const db = serviceDb();
  const { data: i } = await db.from("issues").select("id, project_id, title, followups, feedback_units(source_id, sources(project_id, kind, author, channel, metadata))").eq("id", issueId).single();
  if (!i) return null;
  const { connectionFor } = await import("./sync"); // lazy: keeps next/og out of the routes that import this file
  if (!(await connectionFor(i.project_id, db))) return null;
  // Only the app's own sources: a unit filed under this issue from another app's source never names a thread here.
  const rows: ReporterRow[] = ((i as any).feedback_units ?? []).filter((u: any) => u.sources?.project_id === i.project_id)
    .map((u: any) => ({ source_id: u.source_id, kind: u.sources.kind, author: u.sources.author, channel: u.sources.channel, metadata: u.sources.metadata }));
  return { db, issue: i as any, ...reportersToTell(rows) };
}

/** Posts in the reporter's thread, joining the channel once if the bot isn't in it (a shortcut from another channel). */
async function replyInThread(r: SlackReporter, text: string) {
  const post = () => slackApi("chat.postMessage", { channel: r.channel, thread_ts: r.ts, text, unfurl_links: false });
  try {
    await post();
  } catch (e) {
    if (!(e instanceof SlackError) || e.code !== "not_in_channel") throw e;
    await slackApi("conversations.join", { channel: r.channel });
    await post();
  }
}

/** When an issue ships: tell everyone who raised it in Slack, in their own thread, in the app's workspace. Never throws. */
export async function tellReporters(issueId: string): Promise<{ told: string[] }> {
  if (!slackEnabled()) return { told: [] };
  const projectId = await projectOfIssue(issueId).catch(() => null);
  if (!projectId) return { told: [] };
  return (await inSlackFor(projectId, () => tellReportersHere(issueId))) ?? { told: [] };
}

async function tellReportersHere(issueId: string): Promise<{ told: string[] }> {
  const told: string[] = [];
  const failed = async (error: unknown) => {
    console.error("[slack] telling reporters failed", issueId, error);
    // Visible in the issue's activity, so a missed "it shipped" message isn't silent.
    await serviceDb().from("activity").insert({ issue_id: issueId, kind: "slack_failed", payload: { error: `Telling reporters: ${error instanceof Error ? error.message : String(error)}` } });
  };
  try {
    if (!slackEnabled()) return { told };
    const r = await reportersOf(issueId);
    if (!r) return { told };
    const url = `${env.appUrl()}/issues/${issueId}`;
    for (const rep of r.slack) {
      if (!(await claimAlert(r.db, r.issue.project_id, issueId, "shipped", alertKey.shipped(issueId, rep.sourceId)))) continue;
      try { await replyInThread(rep, shippedReplyText(rep.user, r.issue.title, url)); told.push(rep.name); } catch (e) { await failed(e); }
    }
    if (told.length) await r.db.from("activity").insert({ issue_id: issueId, kind: "reporters_told", payload: { names: told } });
  } catch (e) {
    await failed(e);
  }
  return { told };
}

/** Asks the drafted follow-up questions in each Slack reporter's thread. Their replies come back as feedback. */
export async function askFollowups(issueId: string, userId: string | null): Promise<{ ok: true; asked: string[] } | { ok: false; error: string }> {
  if (!slackEnabled()) return { ok: false, error: "Slack isn't connected" };
  const projectId = await projectOfIssue(issueId).catch(() => null);
  const answer = projectId ? await inSlackFor(projectId, () => askFollowupsHere(issueId, userId)) : null;
  return answer ?? { ok: false, error: "Slack isn't connected to this app" };
}

async function askFollowupsHere(issueId: string, userId: string | null): Promise<{ ok: true; asked: string[] } | { ok: false; error: string }> {
  const r = await reportersOf(issueId);
  if (!r) return { ok: false, error: "Slack isn't connected to this app" };
  const f = r.issue.followups as Followups | null;
  if (!f?.questions?.length) return { ok: false, error: "There are no questions to ask yet" };
  if (!r.slack.length) return { ok: false, error: "Nobody who raised this is on Slack" };
  const asked: string[] = [];
  for (const rep of r.slack) {
    if (!(await claimAlert(r.db, r.issue.project_id, issueId, "followup", `followup:${issueId}:${rep.sourceId}`))) continue;
    try { await replyInThread(rep, followupAskText(rep.user, f.questions)); asked.push(rep.name); } catch (e) { console.error("[slack] follow-up failed", rep.sourceId, e); }
  }
  if (!asked.length) return { ok: false, error: "Already asked everyone on Slack" };
  await r.db.from("issues").update({ followups: { ...f, asked_at: new Date().toISOString(), asked: [...(f.asked ?? []), ...asked] } }).eq("id", issueId);
  await r.db.from("activity").insert({ issue_id: issueId, user_id: userId, kind: "followups_asked", payload: { names: asked } });
  return { ok: true, asked };
}

/**
 * A reply in a front-door thread counts as feedback only when PMA asked a follow-up there, on a source of the app
 * whose inbox the thread is in. Another app's row naming the same thread is never matched, so its issue never gets the answer.
 */
export async function followupSourceFor(projectId: string, channel: string, threadTs: string): Promise<string | null> {
  const db = serviceDb();
  const { data: src } = await db.from("sources").select("id").eq("project_id", projectId).eq("kind", "slack").eq("metadata->slack->>channel", channel).eq("metadata->slack->>ts", threadTs).maybeSingle();
  if (!src) return null;
  const { count } = await db.from("alert_log").select("id", { count: "exact", head: true }).like("dedupe_key", `followup:%:${src.id}`);
  return count ? src.id : null;
}

/** After an answer to a follow-up is filed: note it on the issue that asked (in the app that holds Slack), with where the answer landed. */
export async function noteFollowupAnswer(askedSourceId: string, answerSourceId: string, projectId: string): Promise<void> {
  try {
    const db = serviceDb();
    const [{ data: asked }, { data: answer }, { data: src }] = await Promise.all([
      db.from("feedback_units").select("issue_id").eq("project_id", projectId).eq("source_id", askedSourceId).not("issue_id", "is", null),
      db.from("feedback_units").select("issue_id, issues(title)").eq("project_id", projectId).eq("source_id", answerSourceId).not("issue_id", "is", null),
      db.from("sources").select("raw_text, author").eq("id", answerSourceId).single(),
    ]);
    const filed = [...new Set((answer ?? []).map((u: any) => u.issues?.title as string).filter(Boolean))];
    const issueIds = [...new Set((asked ?? []).map((u) => u.issue_id as string))];
    for (const issueId of issueIds) {
      await db.from("activity").insert({ issue_id: issueId, kind: "followup_answered", payload: { name: src?.author ?? "Someone", quote: src?.raw_text ?? "", filed, source_id: answerSourceId } });
      await (await import("./sync")).syncIssueToSlack(issueId, { board: false });
    }
  } catch (e) {
    console.error("[slack] noting a follow-up answer failed", answerSourceId, e);
  }
}
