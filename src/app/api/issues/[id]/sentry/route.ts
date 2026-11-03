// Sentry errors on an issue. GET: whether the app has Sentry, the errors linked to the issue with their 30-day numbers,
// and with ?suggest=1 the app's synced errors ranked for this issue. POST { external_id }: link one of the app's synced
// errors (any member). DELETE ?link=<id>: unlink. Links are written as the signed-in member, so RLS keeps the issue and
// the link in the same app.
import { NextResponse } from "next/server";
import { appForIssue } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { userDb } from "@/lib/db/server";
import { sentryIssueView, sentrySuggestions } from "@/lib/sentry/issueView";

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SENTRY_ID = /^\d{1,30}$/;

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const app = await appForIssue(id);
  if (!app) return notFoundResponse();
  const db = await userDb();
  const view = await sentryIssueView(db, app.project.id, id);
  if (!view.connected || new URL(req.url).searchParams.get("suggest") !== "1") return NextResponse.json({ ...view, suggestions: null });
  const suggestions = await sentrySuggestions(db, app.project.id, id, new Set(view.links.map((l) => l.external_id)));
  return NextResponse.json({ ...view, suggestions });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const app = await appForIssue(id);
  if (!app) return notFoundResponse();
  const body = (await req.json().catch(() => null)) as { external_id?: unknown } | null;
  const externalId = typeof body?.external_id === "string" ? body.external_id : "";
  if (!SENTRY_ID.test(externalId)) return NextResponse.json({ error: "That isn't a Sentry error." }, { status: 400 });
  const db = await userDb();
  // Only an error the app's last sync saw can be linked: its title and Sentry link come from there.
  const { data: signal } = await db.from("issue_signals").select("label, url").eq("project_id", app.project.id).eq("provider", "sentry").eq("kind", "exception").eq("key", externalId).maybeSingle();
  if (!signal) return NextResponse.json({ error: "That error isn't in this app's Sentry project. Refresh Sentry and try again." }, { status: 400 });
  const { error } = await db.from("issue_links").insert({
    project_id: app.project.id, issue_id: id, provider: "sentry", kind: "error", external_id: externalId,
    title: (signal.label as string | null)?.slice(0, 500) ?? null, url: (signal.url as string | null) ?? null, created_by: app.userId,
  });
  if (error && error.code !== "23505") return NextResponse.json({ error: "Couldn't link that error. Try again." }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const app = await appForIssue(id);
  if (!app) return notFoundResponse();
  const link = new URL(req.url).searchParams.get("link") ?? "";
  if (!UUID.test(link)) return NextResponse.json({ error: "not found" }, { status: 404 });
  await (await userDb()).from("issue_links").delete().eq("id", link).eq("issue_id", id).eq("provider", "sentry");
  return NextResponse.json({ ok: true });
}
