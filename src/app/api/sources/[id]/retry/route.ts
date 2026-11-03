import { NextResponse, after } from "next/server";
import { appForSource } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { runSource } from "@/lib/pipeline/deps";
export const maxDuration = 300;
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await appForSource(id))) return notFoundResponse();
  after(() => runSource(id));
  return NextResponse.json({ ok: true });
}
