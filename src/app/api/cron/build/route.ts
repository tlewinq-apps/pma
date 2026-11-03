// Runs (or goes on with) one Build it attempt in its own invocation: started after an approval or a Try again, handed
// on by the invocation before it (with its lease), or picked up by /api/cron/process. Internal: CRON_SECRET only. It
// answers at once and works in after(), up to the function's limit (lib/build/run.ts hands over before it).
import { NextResponse, after } from "next/server";
import { env } from "@/lib/env";
import { runBuild } from "@/lib/build/run";

export const maxDuration = 300;

export async function POST(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${env.cronSecret()}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { id?: unknown; lease?: unknown } | null;
  const id = typeof body?.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
  if (!id) return NextResponse.json({ error: "which build?" }, { status: 400 });
  const lease = typeof body?.lease === "string" && /^[0-9a-f-]{36}$/i.test(body.lease) ? body.lease : null;
  const origin = new URL(req.url).origin;
  after(async () => {
    try { await runBuild(id, { origin, lease }); } catch (e) { console.error("[build] run crashed", id, (e as Error).message); }
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
