import { NextResponse, after } from "next/server";
import { projectForApiKey } from "@/lib/api/auth";
import { parseFeedbackBody } from "@/lib/api/v1";
import { enqueueSource } from "@/lib/ingest/enqueue";
import { runSource } from "@/lib/pipeline/deps";
export const maxDuration = 300;

export async function POST(req: Request) {
  const project = await projectForApiKey(req);
  if (!project) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const v = parseFeedbackBody(await req.json().catch(() => null));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const r = await enqueueSource(project.id, { kind: "paste", ...v.input });
  if (!r.duplicate) after(() => runSource(r.id));
  return NextResponse.json(r, { status: r.duplicate ? 200 : 201 });
}
