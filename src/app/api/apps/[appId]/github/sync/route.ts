import { NextResponse } from "next/server";
import { appById } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { syncScreens } from "@/lib/marver/sync";
export const maxDuration = 300;
export async function POST(_req: Request, { params }: { params: Promise<{ appId: string }> }) {
  const ctx = await appById((await params).appId);
  if (!ctx) return notFoundResponse();
  try { return NextResponse.json(await syncScreens(ctx.project.id)); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
