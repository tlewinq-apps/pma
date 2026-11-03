// Links from the web app into Slack. Server only: slack_threads is service-role only.
import { serviceDb } from "@/lib/db/server";
import { slackEnabled } from "@/lib/env";
import { slackTeam } from "./api";
import { permalink } from "./ids";
import { inSlackFor } from "./tenant";

/** The issue's card thread in Slack, or null without the app, before the card is posted, or when Slack can't be reached. */
export async function slackThreadUrl(issueId: string): Promise<string | null> {
  if (!slackEnabled()) return null;
  try {
    const { data: t } = await serviceDb().from("slack_threads").select("channel_id, ts, issues(project_id)").eq("issue_id", issueId).maybeSingle();
    const projectId = (t?.issues as { project_id?: string } | null)?.project_id;
    if (!t?.channel_id || !t.ts || !projectId) return null;
    return await inSlackFor(projectId, async () => permalink((await slackTeam()).url, t.channel_id!, t.ts!));
  } catch {
    return null;
  }
}
