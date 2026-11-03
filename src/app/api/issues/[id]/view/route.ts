import { NextResponse } from "next/server";
import { appForIssue } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { serviceDb } from "@/lib/db/server";
export async function POST(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await appForIssue(id);
  if (!ctx) return notFoundResponse();
  const since = new Date(Date.now() - 60 * 60_000).toISOString();
  const { count } = await serviceDb().from("activity").select("id", { count: "exact", head: true }).eq("issue_id", id).eq("user_id", ctx.userId).eq("kind", "viewed").gte("at", since);
  if (!count) await serviceDb().from("activity").insert({ issue_id: id, user_id: ctx.userId, kind: "viewed", payload: {} });
  return NextResponse.json({ ok: true });
}
