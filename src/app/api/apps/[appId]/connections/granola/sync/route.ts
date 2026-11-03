// "Check for new notes now": the same catch-up the daily cron runs, for this company. Owners and admins only.
import { NextResponse } from "next/server";
import { appById } from "@/lib/db/app";
import { adminOnly, notFoundResponse } from "@/lib/api/guards";
import { findConnection } from "@/lib/connections/store";
import { granolaCatchUp } from "@/lib/granola/notes";

export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ appId: string }> }) {
  const ctx = await appById((await params).appId);
  if (!ctx) return notFoundResponse();
  const denied = adminOnly(ctx);
  if (denied) return denied;
  const conn = await findConnection("granola", { orgId: ctx.org.id, projectId: null });
  if (!conn || conn.status !== "ok") return NextResponse.json({ error: "Connect Granola first." }, { status: 400 });
  const r = await granolaCatchUp(conn.id);
  return r.error ? NextResponse.json({ error: "Granola couldn't be read just now. Try again in a minute." }, { status: 502 }) : NextResponse.json(r);
}
