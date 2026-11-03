import { NextResponse } from "next/server";
import { serviceDb } from "@/lib/db/server";
import { env } from "@/lib/env";
import { postDigest } from "@/lib/alerts/digest";
import { refreshPriorities } from "@/lib/pipeline/age";
import { granolaCatchUpAll } from "@/lib/granola/notes";
import { posthogSyncAll } from "@/lib/posthog/sync";
import { sentrySyncAll } from "@/lib/sentry/sync";

export const maxDuration = 300;

/**
 * Once a day (vercel.json): age every project's priorities, post the morning digest where Slack is set up, then the
 * connectors' daily work: the Granola catch-up for every connected workspace (Granola doesn't replay webhooks after
 * four days; queued notes are read by /api/cron/process), and the PostHog and Sentry refreshes for every connected project. It is
 * one route because Vercel's Hobby plan allows two daily crons, and /api/cron/process is the other.
 */
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${env.cronSecret()}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: projects } = await serviceDb().from("projects").select("id");
  const aged: Record<string, unknown> = {};
  for (const { id } of projects ?? []) aged[id] = await refreshPriorities(id).catch((e: Error) => ({ error: e.message }));
  const { data: inboxes } = await serviceDb().from("slack_channels").select("project_id").eq("role", "inbox");
  const digests: Record<string, unknown> = {};
  for (const { project_id } of inboxes ?? []) digests[project_id] = await postDigest(project_id, { manual: false }).catch((e: Error) => ({ posted: false, reason: e.message }));
  // Each connector's run reports its own failures; one throwing doesn't stop the other.
  const granola = await granolaCatchUpAll().catch((e: Error) => ({ error: e.message }));
  const posthog = await posthogSyncAll().catch((e: Error) => ({ error: e.message }));
  const sentry = await sentrySyncAll().catch((e: Error) => ({ error: e.message }));
  return NextResponse.json({ aged, digests, granola, posthog, sentry });
}
