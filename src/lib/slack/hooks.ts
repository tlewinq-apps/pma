import { after } from "next/server";
import { slackEnabled } from "@/lib/env";

/** Brings the issue's Slack card and thread up to date now. A no-op without the Slack app; never throws. */
export async function slackSyncNow(issueId: string): Promise<void> {
  if (!slackEnabled()) return;
  const { syncIssueToSlack } = await import("./sync"); // lazy: keeps next/og out of ordinary routes
  await syncIssueToSlack(issueId);
}

/** From a route handler: the same, after the response is sent. */
export function slackSyncLater(issueId: string): void {
  if (slackEnabled()) after(() => slackSyncNow(issueId));
}
