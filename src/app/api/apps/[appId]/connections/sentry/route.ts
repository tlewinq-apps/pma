// An app's Sentry. POST { token, url? } connects with a person's auth token (org:read, project:read, event:read), on
// sentry.io or a self-hosted Sentry at `url`; PATCH { project } picks the project ("org/project") when the token
// reaches several; DELETE disconnects. Owners and admins only. The token goes to Vault and is never sent back.
import { NextResponse, after } from "next/server";
import { appById } from "@/lib/db/app";
import { adminOnly, notFoundResponse } from "@/lib/api/guards";
import { audit, disconnect, findConnection } from "@/lib/connections/store";
import { runSource } from "@/lib/pipeline/deps";
import { SENTRY_URL, sentryBaseUrl } from "@/lib/sentry/client";
import { chooseSentryProject, saveSentryToken } from "@/lib/sentry/connection";
import { sentrySync } from "@/lib/sentry/sync";

export const maxDuration = 300;
type Ctx = { params: Promise<{ appId: string }> };
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

async function editable(appId: string) {
  const ctx = await appById(appId);
  if (!ctx) return { res: notFoundResponse() } as const;
  const denied = adminOnly(ctx);
  if (denied) return { res: denied } as const;
  return { ctx, scope: { orgId: ctx.org.id, projectId: ctx.project.id, userId: ctx.userId } } as const;
}

/** The first sync, after the response: errors and feedback come in, and new feedback is read at once. */
const firstSync = (projectId: string) => after(async () => {
  const r = await sentrySync(projectId);
  if (r.ok) for (const id of r.queued.slice(0, 10)) await runSource(id).catch((e: Error) => console.error("[sentry] feedback failed", id, e.message));
});

export async function POST(req: Request, { params }: Ctx) {
  const r = await editable((await params).appId);
  if ("res" in r) return r.res;
  const body = (await req.json().catch(() => null)) as { token?: unknown; url?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) return bad("Paste your Sentry token.");
  const rawUrl = typeof body?.url === "string" ? body.url.trim() : "";
  const base = rawUrl ? sentryBaseUrl(rawUrl) : SENTRY_URL;
  if (!base) return bad("Enter your self-hosted Sentry's https address, like https://sentry.example.com.");
  const saved = await saveSentryToken(r.scope, token, { base });
  if (!saved.ok) return bad(saved.error);
  if (saved.connected) firstSync(r.scope.projectId);
  return NextResponse.json(saved);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const r = await editable((await params).appId);
  if ("res" in r) return r.res;
  const body = (await req.json().catch(() => null)) as { project?: unknown } | null;
  const key = typeof body?.project === "string" ? body.project : "";
  if (!key) return bad("Pick a Sentry project.");
  const chosen = await chooseSentryProject(r.scope, key);
  if (!chosen.ok) return bad(chosen.error);
  firstSync(r.scope.projectId);
  return NextResponse.json(chosen);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const r = await editable((await params).appId);
  if ("res" in r) return r.res;
  const conn = await findConnection("sentry", { orgId: r.scope.orgId, projectId: r.scope.projectId });
  if (conn) await disconnect(conn.id);
  await audit({ orgId: r.scope.orgId, projectId: r.scope.projectId, actorId: r.scope.userId, action: "connection.disconnected", target: "sentry" });
  return NextResponse.json({ ok: true });
}
