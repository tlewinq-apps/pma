// PostHog errors on an issue. GET: whether the app has PostHog, the errors linked to the issue with their 30-day
// numbers, how many PostHog users the issue touches, and with ?suggest=1 the app's recent errors ranked for this issue.
// POST { external_id, title }: link an error (any member). DELETE ?link=<id>: unlink. Links are written as the signed-in
// member, so RLS keeps the issue and the link in the same app.
import { NextResponse } from "next/server";
import { appForIssue } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { userDb } from "@/lib/db/server";
import { posthogHost } from "@/lib/posthog/client";
import { posthogFor } from "@/lib/posthog/connection";
import { rankErrors, recentErrors } from "@/lib/posthog/errors";
import { posthogIssueView } from "@/lib/posthog/issueView";
import { ERROR_ID } from "@/lib/posthog/sync";

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const app = await appForIssue(id);
  if (!app) return notFoundResponse();
  const db = await userDb();
  const view = await posthogIssueView(db, app.project.id, id);
  if (!view.connected || new URL(req.url).searchParams.get("suggest") !== "1") return NextResponse.json({ ...view, suggestions: null });
  const ph = await posthogFor(app.project.id).catch(() => null);
  if (!ph?.config.project_id) return NextResponse.json({ connected: false });
  try {
    const { data: issue } = await db.from("issues").select("title, problem_statement, feedback_units(quote)").eq("id", id).maybeSingle();
    const linked = new Set(view.links.map((l) => l.external_id));
    const errors = (await recentErrors(ph.api, ph.config.project_id)).filter((e) => !linked.has(e.id));
    const quotes = ((issue as { feedback_units?: { quote: string }[] } | null)?.feedback_units ?? []).map((u) => u.quote).slice(0, 6);
    const suggestions = rankErrors({ title: issue?.title ?? "", problem: issue?.problem_statement ?? null, quotes }, errors).slice(0, 12);
    return NextResponse.json({ ...view, suggestions });
  } catch {
    return NextResponse.json({ error: "PostHog couldn't be read just now. Try again in a minute." }, { status: 502 });
  }
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const app = await appForIssue(id);
  if (!app) return notFoundResponse();
  const ph = await posthogFor(app.project.id).catch(() => null);
  if (!ph?.config.project_id) return NextResponse.json({ error: "Connect PostHog first." }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { external_id?: unknown; title?: unknown } | null;
  const externalId = typeof body?.external_id === "string" ? body.external_id : "";
  if (!ERROR_ID.test(externalId)) return NextResponse.json({ error: "That isn't a PostHog error." }, { status: 400 });
  const title = typeof body?.title === "string" ? body.title.slice(0, 500) : null;
  const host = posthogHost(ph.config.region);
  const url = host.startsWith("https://") ? `${host}/project/${ph.config.project_id}/error_tracking/${encodeURIComponent(externalId)}` : null;
  const { error } = await (await userDb()).from("issue_links").insert({ project_id: app.project.id, issue_id: id, provider: "posthog", kind: "error", external_id: externalId, title, url, created_by: app.userId });
  if (error && error.code !== "23505") return NextResponse.json({ error: "Couldn't link that error. Try again." }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const app = await appForIssue(id);
  if (!app) return notFoundResponse();
  const link = new URL(req.url).searchParams.get("link") ?? "";
  if (!UUID.test(link)) return NextResponse.json({ error: "not found" }, { status: 404 });
  await (await userDb()).from("issue_links").delete().eq("id", link).eq("issue_id", id);
  return NextResponse.json({ ok: true });
}
