import { NextResponse, after } from "next/server";
import { env } from "@/lib/env";
import { runQueued } from "@/lib/ingest/drainRun";

export const maxDuration = 300;

/** Carries on a batch of sources that ran out of time in the function that queued them (see drainSources). */
export async function POST(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${env.cronSecret()}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 100) : [];
  if (!ids.length) return NextResponse.json({ error: "No source ids" }, { status: 400 });
  after(() => runQueued(ids, new URL(req.url).origin));
  return NextResponse.json({ queued: ids.length }, { status: 202 });
}
