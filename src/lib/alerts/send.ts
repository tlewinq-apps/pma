/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase nested selects are untyped */
// Sends alerts: claims each one in alert_log (so it goes out once), DMs the people who should know, and logs an
// `alert` activity that the Slack sync replays into the issue's card thread.
import type { SupabaseClient } from "@supabase/supabase-js";
import { awaitingDiagnosis, parseDiagnosis } from "@/lib/diagnosis/model";
import { serviceDb } from "@/lib/db/server";
import { env, slackEnabled } from "@/lib/env";
import type { ScoredEvent } from "@/lib/pipeline/run";
import type { PriorityChange } from "@/lib/scoring";
import { alertMessage } from "./messages";
import { peopleTextFor } from "@/lib/proposals";
import { alertsFor, parseAlertRules, type Alert } from "./rules";
import { slackIsMine } from "@/lib/slack/ownership";
import { inSlackFor } from "@/lib/slack/tenant";

/** Inserts the alert's dedupe row. False when it was already sent (unique violation), so the caller skips it. */
export async function claimAlert(db: SupabaseClient, projectId: string, issueId: string | null, rule: string, key: string, payload: Record<string, unknown> = {}): Promise<boolean> {
  const { error } = await db.from("alert_log").insert({ project_id: projectId, issue_id: issueId, rule, dedupe_key: key, payload });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(`alert_log: ${error.message}`);
}

/** Emails of the PMA members who should hear about this issue: the chosen recipients plus its owner. */
async function recipientEmails(db: SupabaseClient, projectId: string, userIds: string[]): Promise<{ userId: string; email: string }[]> {
  if (!userIds.length) return [];
  const { data } = await db.rpc("service_member_emails", { p_project: projectId });
  return ((data ?? []) as { user_id: string; email: string }[]).filter((m) => userIds.includes(m.user_id)).map((m) => ({ userId: m.user_id, email: m.email }));
}

/**
 * DMs one person by email. chat.postMessage to a user id opens the app's DM without extra scopes on most workspaces;
 * conversations.open (im:write) is the fallback. Returns the Slack name on success, or the error code.
 */
export async function dmByEmail(email: string, msg: { text: string; blocks: object[] }): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const { slackApi, SlackError } = await import("@/lib/slack/api");
  try {
    const { user } = await slackApi<{ user: { id: string; real_name?: string; profile?: { display_name?: string; real_name?: string } } }>("users.lookupByEmail", { email });
    const name = user.profile?.display_name || user.profile?.real_name || user.real_name || email.split("@")[0];
    try {
      await slackApi("chat.postMessage", { channel: user.id, ...msg, unfurl_links: false });
    } catch (e) {
      if (!(e instanceof SlackError)) throw e;
      const { channel } = await slackApi<{ channel: { id: string } }>("conversations.open", { users: user.id });
      await slackApi("chat.postMessage", { channel: channel.id, ...msg, unfurl_links: false });
    }
    return { ok: true, name };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function deliver(db: SupabaseClient, issueId: string, alert: Alert, e: ScoredEvent, rules: ReturnType<typeof parseAlertRules>) {
  const { data: i } = await db.from("issues").select("id, project_id, title, type, importance, people_count, owner_id, score_breakdown, diagnosis, projects(kind, product_profile, name), feedback_units(quote, audience, created_at, sources(author))").eq("id", issueId).single();
  if (!i) return;
  const x = i as any;
  const quote = [...(x.feedback_units ?? [])].sort((a: any, b: any) => b.created_at.localeCompare(a.created_at))[0];
  const msg = alertMessage({
    issueId, title: x.title, type: x.type, url: `${env.appUrl()}/issues/${issueId}`, importance: e.next, severity: e.severity,
    people: Number(x.people_count), reach: Number(x.score_breakdown?.reach ?? 0), quote: quote ? { text: quote.quote, author: quote.sources?.author ?? null } : null,
    rule: alert.rule, detail: alert.detail, reason: alert.rule === "jump" ? e.reason : null,
    diagnose: awaitingDiagnosis(x.type, parseDiagnosis(x.diagnosis)),
    peopleText: peopleTextFor(x.projects, Number(x.people_count), x.feedback_units),
  });
  const people = await recipientEmails(db, x.project_id, [...new Set([...rules.recipients, ...(x.owner_id ? [x.owner_id] : [])])]);
  const sent: string[] = [];
  const failed: { email: string; error: string }[] = [];
  // DMs go out in the app's own Slack workspace, once its channels are set up. An app without Slack still logs the
  // alert on the issue; nobody is looked up or messaged in a workspace that isn't the app's.
  if (slackEnabled() && (await slackIsMine(x.project_id))) {
    await inSlackFor(x.project_id, async () => {
      for (const p of people) {
        const r = await dmByEmail(p.email, msg);
        if (r.ok) sent.push(r.name); else failed.push({ email: p.email, error: r.error });
      }
    });
  }
  await db.from("activity").insert({ issue_id: issueId, kind: "alert", payload: { rule: alert.rule, ...alert.detail, sent_to: sent, ...(failed.length ? { failed } : {}) } });
  if (slackEnabled()) await (await import("@/lib/slack/hooks")).slackSyncNow(issueId);
}

/** The pipeline's onScored hook (deps.ts): works out which alerts the new score triggers and sends each once. */
export async function alertsAfterScore(issueId: string, e: ScoredEvent): Promise<void> {
  const db = serviceDb();
  const { data: i } = await db.from("issues").select("project_id, projects(alert_rules)").eq("id", issueId).single();
  if (!i) return;
  const rules = parseAlertRules((i as any).projects?.alert_rules);
  const { data: rows } = await db.from("activity").select("at, payload").eq("issue_id", issueId).eq("kind", "priority_changed");
  const history: PriorityChange[] = (rows ?? []).map((r: any) => ({ at: r.at, from: r.payload?.from ?? null, to: Number(r.payload?.to) }));
  const { data: lastJump } = await db.from("alert_log").select("sent_at").eq("issue_id", issueId).eq("rule", "jump").order("sent_at", { ascending: false }).limit(1).maybeSingle();
  const lastJumpAt = lastJump ? Date.parse(lastJump.sent_at) : null;
  for (const alert of alertsFor({ issueId, type: e.type, severity: e.severity, signals: e.signals, next: e.next, history, now: Date.now(), rules, wasBlocking: e.wasBlocking, isNew: e.prev == null, lastJumpAt })) {
    if (await claimAlert(db, i.project_id, issueId, alert.rule, alert.key, alert.detail)) await deliver(db, issueId, alert, e, rules);
  }
}
