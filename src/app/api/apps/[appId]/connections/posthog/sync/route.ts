// "Refresh now" for an app's PostHog numbers (the daily cron does the same for every app). Owners and admins only.
import { NextResponse } from "next/server";
import { appById } from "@/lib/db/app";
import { adminOnly, notFoundResponse } from "@/lib/api/guards";
import { posthogSync } from "@/lib/posthog/sync";

export const maxDuration = 120;

export async function POST(_req: Request, { params }: { params: Promise<{ appId: string }> }) {
  const ctx = await appById((await params).appId);
  if (!ctx) return notFoundResponse();
  const denied = adminOnly(ctx);
  if (denied) return denied;
  const r = await posthogSync(ctx.project.id);
  return r.ok ? NextResponse.json(r) : NextResponse.json({ error: "PostHog couldn't be read just now. Try again in a minute." }, { status: 502 });
}
