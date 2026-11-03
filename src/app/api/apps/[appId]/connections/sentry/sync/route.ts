// "Refresh now" for an app's Sentry (the crons do the same for every app). Owners and admins only. New feedback is
// read after the response, so the button answers at once.
import { NextResponse, after } from "next/server";
import { appById } from "@/lib/db/app";
import { adminOnly, notFoundResponse } from "@/lib/api/guards";
import { runSource } from "@/lib/pipeline/deps";
import { sentrySync } from "@/lib/sentry/sync";

export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ appId: string }> }) {
  const ctx = await appById((await params).appId);
  if (!ctx) return notFoundResponse();
  const denied = adminOnly(ctx);
  if (denied) return denied;
  const r = await sentrySync(ctx.project.id);
  if (!r.ok) return NextResponse.json({ error: "Sentry couldn't be read just now. Try again in a minute." }, { status: 502 });
  after(async () => {
    for (const id of r.queued.slice(0, 10)) await runSource(id).catch((e: Error) => console.error("[sentry] feedback failed", id, e.message));
  });
  return NextResponse.json({ ok: true, errors: r.errors, feedback: r.feedback, queued: r.queued.length });
}
