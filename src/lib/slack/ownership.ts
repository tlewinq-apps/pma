// Whose Slack an app is on, for what people see. Each company installs PMA in its own workspace, and each app has
// its own channels there (src/lib/slack/tenant.ts), so "mine" now means: this app reaches a workspace and has its
// channels set up in it. The deployment's own workspace (SLACK_BOT_TOKEN, the demo) is the only one with a shared
// invite link (SLACK_INVITE_URL), so only an app on that workspace offers it, and the tour's Join Slack step with it.
import { slackInviteUrl } from "@/lib/env";
import { slackConnected, slackForProject } from "./tenant";

/** Whether this app has Slack: a workspace it reaches, with its channels set up. False when the check fails. */
export async function slackIsMine(projectId: string): Promise<boolean> {
  try {
    return await slackConnected(projectId);
  } catch (e) {
    console.error("[slack] connection check failed", e);
    return false;
  }
}

/** The deployment workspace's invite link, for an app on that workspace with its channels set up; otherwise null. */
export async function slackInviteFor(projectId: string): Promise<string | null> {
  const invite = slackInviteUrl();
  if (!invite) return null;
  const client = await slackForProject(projectId).catch(() => null);
  return client?.legacy && (await slackIsMine(projectId)) ? invite : null;
}
