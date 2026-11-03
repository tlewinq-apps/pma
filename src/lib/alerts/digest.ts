// The daily digest in the Slack front door: the five highest-priority open issues, what's new, and what shipped.
import { serviceDb } from "@/lib/db/server";
import { env, slackEnabled } from "@/lib/env";
import type { IssueType } from "@/lib/types";
import { buildDigest, digestMessage } from "./messages";
import { alertKey, parseAlertRules } from "./rules";
import { claimAlert } from "./send";

export type DigestResult = { posted: true } | { posted: false; reason: string };

/** `manual` (Settings > Send digest now) skips the once-a-day check and the on/off switch. */
export async function postDigest(projectId: string, opts: { manual: boolean; now?: number } = { manual: false }): Promise<DigestResult> {
  const now = opts.now ?? Date.now();
  if (!slackEnabled()) return { posted: false, reason: "Slack isn't connected" };
  const db = serviceDb();
  const { data: project } = await db.from("projects").select("alert_rules").eq("id", projectId).single();
  if (!opts.manual && !parseAlertRules(project?.alert_rules).digest.enabled) return { posted: false, reason: "The digest is switched off" };
  const { data: inbox } = await db.from("slack_channels").select("channel_id").eq("project_id", projectId).eq("role", "inbox").maybeSingle();
  if (!inbox) return { posted: false, reason: "Create the Slack channels first" };
  const key = opts.manual ? `digest:manual:${now}` : alertKey.digest(now);
  if (!(await claimAlert(db, projectId, null, "digest", key))) return { posted: false, reason: "Already sent today" };

  const { data: issues } = await db.from("issues").select("id, title, type, importance, status, owner_id, created_at, updated_at").eq("project_id", projectId);
  const { displayNames } = await import("@/lib/slack/users");
  const { inSlackFor } = await import("@/lib/slack/tenant");
  const owners = (await inSlackFor(projectId, () => displayNames(projectId, (issues ?? []).map((i) => i.owner_id)))) ?? new Map<string, string>();
  const digest = buildDigest((issues ?? []).map((i) => ({
    id: i.id, title: i.title, type: i.type as IssueType, importance: i.importance, status: i.status, owner: i.owner_id ? owners.get(i.owner_id) ?? "a teammate" : null,
    createdAt: i.created_at, updatedAt: i.updated_at, link: `${env.appUrl()}/issues/${i.id}`,
  })), now);
  const { slackApi } = await import("@/lib/slack/api");
  // Posted in the app's own workspace; an app whose company has no Slack any more gets nothing.
  const posted = await inSlackFor(projectId, async () => {
    await slackApi("chat.postMessage", { channel: inbox.channel_id, ...digestMessage(digest, env.appUrl(), now), unfurl_links: false, unfurl_media: false });
    return true;
  });
  return posted ? { posted: true } : { posted: false, reason: "Slack isn't connected" };
}
