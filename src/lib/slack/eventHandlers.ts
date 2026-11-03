// What the events endpoint does after it has acknowledged Slack (runs inside after()). Every event is routed by the
// team_id Slack sends with it: the workspace's installation (or the legacy demo workspace) gives the bot token and the
// company, and a message only counts when its channel belongs to one of that company's apps.
import { serviceDb } from "@/lib/db/server";
import { slackTeam } from "./api";
import { withSlack, type SlackClient } from "./context";
import { classifyEvent, slackToPlain } from "./events";
import { ingestSlackMessage, replyFiled, runFeedbackFlow } from "./inbox";
import { connectionForChannel, firstConnection, publishHome } from "./sync";
import { appsForSlack, slackForTeam } from "./tenant";
import { resolveSlackUser } from "./users";
import { revokeInstallation } from "./install";

export type EventEnvelope = { team_id?: unknown; enterprise_id?: unknown; event?: unknown };

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export async function handleEvent(body: EventEnvelope): Promise<void> {
  try {
    const teamId = str(body.team_id);
    const event = body.event as Record<string, unknown> | undefined;
    // The app was removed from the workspace, or its bot token revoked: the company's Slack stops at once.
    if (event?.type === "app_uninstalled") return void (teamId && (await revokeInstallation(teamId, "PMA was removed from this Slack workspace.")));
    if (event?.type === "tokens_revoked") {
      const bots = ((event.tokens as { bot?: unknown[] } | undefined)?.bot ?? []).filter((b): b is string => typeof b === "string");
      if (teamId && bots.length) await revokeInstallation(teamId, "The workspace revoked PMA's access.", bots);
      return;
    }
    const slack = await slackForTeam(teamId);
    if (!slack) return; // a workspace no company has connected (or one that was disconnected)
    await withSlack(slack, () => routeEvent(event, slack));
  } catch (e) {
    console.error("[slack] event failed", e);
  }
}

async function routeEvent(event: unknown, slack: SlackClient): Promise<void> {
  const apps = await appsForSlack(slack);
  const team = await slackTeam();
  const channel = str((event as Record<string, unknown> | undefined)?.channel);
  const conn = channel ? await connectionForChannel(channel, apps) : null;
  const categories = new Set(Object.entries(conn?.channels ?? {}).filter(([role]) => role !== "inbox").map(([, c]) => c!.id));
  const a = classifyEvent(event, { inbox: conn?.channels.inbox?.id ?? null, categoryChannels: categories, botUserId: team.user_id });
  if (a.kind === "home") return publishHome(a.user, await firstConnection(apps));
  if (!conn || a.kind === "ignore") return;

  if (a.kind === "ingest") {
    const r = await ingestSlackMessage({ projectId: conn.projectId, channel: a.channel, ts: a.ts, user: a.user, text: a.text, via: "inbox" });
    const reply = { kind: "thread" as const, channel: a.channel, ts: a.ts };
    return r.duplicate ? replyFiled(r.id, reply, "duplicate") : runFeedbackFlow(r.id, reply);
  }

  // A reply in a front-door thread: new feedback only when it answers follow-up questions PMA asked there.
  if (a.kind === "reply") {
    const { followupSourceFor } = await import("./reporters");
    const askedOn = await followupSourceFor(conn.projectId, a.channel, a.threadTs);
    if (!askedOn) return;
    const r = await ingestSlackMessage({ projectId: conn.projectId, channel: a.channel, ts: a.ts, user: a.user, text: a.text, via: "reply", threadTs: a.threadTs });
    if (r.duplicate) return;
    await runFeedbackFlow(r.id, { kind: "thread", channel: a.channel, ts: a.threadTs });
    const { noteFollowupAnswer } = await import("./reporters");
    return noteFollowupAnswer(askedOn, r.id, conn.projectId);
  }

  // A reply under a card: logged on the issue so the web workspace shows the discussion. Never echoed back. Only a
  // card of this app counts, so a thread in a shared channel can't write into another app's issue.
  const db = serviceDb();
  const { data: thread } = await db.from("slack_threads").select("issue_id, issues!inner(project_id)").eq("channel_id", a.channel).eq("ts", a.threadTs).eq("issues.project_id", conn.projectId).maybeSingle();
  if (!thread) return;
  const { count } = await db.from("activity").select("id", { count: "exact", head: true }).eq("issue_id", thread.issue_id).eq("kind", "commented").eq("payload->>slack_ts", a.ts);
  if (count) return;
  const person = await resolveSlackUser(a.user, conn.projectId);
  await db.from("activity").insert({
    issue_id: thread.issue_id, user_id: person.userId, kind: "commented",
    payload: { text: slackToPlain(a.text), source: "slack", name: person.name, slack_user: a.user, slack_ts: a.ts },
  });
}
