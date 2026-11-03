import { NextResponse } from "next/server";
import { serviceDb } from "@/lib/db/server";
import { env } from "@/lib/env";
import { runSource } from "@/lib/pipeline/deps";
import { pickUpBuilds } from "@/lib/build/pickup";
import { sentrySyncAll } from "@/lib/sentry/sync";
export const maxDuration = 300;
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${env.cronSecret()}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const stale = new Date(Date.now() - 10 * 60_000).toISOString();
  // queued, failed-with-retries-left (R10), or stale processing locks
  const { data } = await serviceDb().from("sources").select("id")
    .or(`status.eq.queued,status.eq.failed,and(status.eq.processing,locked_at.lt.${stale})`).lt("attempts", 3).order("created_at").limit(5);
  for (const s of data ?? []) await runSource(s.id);
  // Build it: attempts whose run never started (queued over a minute) or stopped saving (running, six minutes quiet).
  const builds = await pickUpBuilds(new URL(req.url).origin).catch((e: Error) => { console.error("[build] pick-up failed", e.message); return 0; });
  // Slack: advance demo drafts, post missing cards, catch up threads a best-effort sync missed, refresh the board.
  const slack = await (await import("@/lib/slack/sync")).sweepSlack();
  // Sentry: two apps a run that haven't refreshed in the last hour, so new feedback arrives within the hour.
  const sentry = Object.keys(await sentrySyncAll(serviceDb(), { due: true, max: 2 }).catch(() => ({}))).length;
  return NextResponse.json({ processed: data?.length ?? 0, slack, builds, sentry });
}
