import { NextResponse } from "next/server";
import { appById } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { postDigest } from "@/lib/alerts/digest";

/** Settings > Send digest now. */
export async function POST(_req: Request, { params }: { params: Promise<{ appId: string }> }) {
  const ctx = await appById((await params).appId);
  if (!ctx) return notFoundResponse();
  const r = await postDigest(ctx.project.id, { manual: true }).catch((e: Error) => ({ posted: false as const, reason: e.message }));
  return r.posted ? NextResponse.json(r) : NextResponse.json({ error: r.reason }, { status: 400 });
}
