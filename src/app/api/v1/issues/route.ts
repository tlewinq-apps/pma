import { NextResponse } from "next/server";
import { projectForApiKey } from "@/lib/api/auth";
import { parseLane } from "@/lib/api/v1";
import { serviceDb } from "@/lib/db/server";

export async function GET(req: Request) {
  const project = await projectForApiKey(req);
  if (!project) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const l = parseLane(new URL(req.url).searchParams.get("lane"));
  if (!l.ok) return NextResponse.json({ error: l.error }, { status: l.status });
  let q = serviceDb().from("issues")
    .select("id,short_id,title,problem_statement,type,lane,status,importance,ease,people_count,updated_at")
    .eq("project_id", project.id).neq("status", "dismissed").order("importance", { ascending: false });
  if (l.lane) q = q.eq("lane", l.lane);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: "query failed" }, { status: 500 });
  return NextResponse.json({ issues: data ?? [] });
}
