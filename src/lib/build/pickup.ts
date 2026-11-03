// The safety net for Build it: /api/cron/process asks for attempts whose run never started (queued for over a minute:
// the after-approval hand-off was lost) or stopped saving (running, quiet for STALE_MS: the invocation died), with
// attempts left, and hands each to a fresh invocation. run.ts decides again whether it is really its to take.
import { serviceDb } from "@/lib/db/server";
import { kickBuild, MAX_ATTEMPTS, STALE_MS } from "./run";

export async function pickUpBuilds(origin: string): Promise<number> {
  const db = serviceDb();
  const queuedBefore = new Date(Date.now() - 60_000).toISOString();
  const staleBefore = new Date(Date.now() - STALE_MS).toISOString();
  const { data, error } = await db.from("builds").select("id")
    .or(`and(status.eq.queued,updated_at.lt.${queuedBefore}),and(status.eq.running,locked_at.lt.${staleBefore})`)
    .lt("attempts", MAX_ATTEMPTS).order("created_at").limit(3);
  if (error) throw new Error(error.message);
  for (const b of data ?? []) kickBuild(b.id as string, origin);
  return data?.length ?? 0;
}
