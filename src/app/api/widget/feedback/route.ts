import { NextResponse, after } from "next/server";
import { serviceDb } from "@/lib/db/server";
import { validateWidgetRequest, widgetCapExceeded, parseWidgetCap } from "@/lib/ingest/widget";
import { enqueueSource } from "@/lib/ingest/enqueue";
import { runSource } from "@/lib/pipeline/deps";
export const maxDuration = 300;

const cors = (origin: string | null) => ({ "access-control-allow-origin": origin ?? "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" });
export async function OPTIONS(req: Request) { return new Response(null, { headers: cors(req.headers.get("origin")) }); }

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const key = new URL(req.url).searchParams.get("key") ?? "";
  const { data: project } = await serviceDb().from("projects").select("id,widget_origins").eq("widget_key", key).maybeSingle();
  const body = await req.json().catch(() => null);
  const v = validateWidgetRequest(body, origin, project);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status, headers: cors(origin) });
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { count } = await serviceDb().from("sources").select("id", { count: "exact", head: true })
    .eq("project_id", project!.id).eq("kind", "widget").gt("created_at", since);
  if (widgetCapExceeded(count ?? 0, parseWidgetCap(process.env.WIDGET_DAILY_CAP))) {
    return NextResponse.json({ error: "daily widget limit reached" }, { status: 429, headers: cors(origin) });
  }
  const r = await enqueueSource(project!.id, { kind: "widget", raw_text: v.text, author: v.user, channel: "In-app widget", route: v.route, metadata: { ua: req.headers.get("user-agent") } });
  if (!r.duplicate) after(() => runSource(r.id));
  return NextResponse.json({ ok: true }, { headers: cors(origin) });
}
