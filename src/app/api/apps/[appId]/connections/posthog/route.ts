// An app's PostHog. POST { region, key } connects with a personal API key (phx_, read access to the project and
// queries); PATCH { project_id } picks the project after either sign-in; DELETE disconnects. Owners and admins only.
// Credentials go to Vault and are never sent back.
import { NextResponse, after } from "next/server";
import { appById } from "@/lib/db/app";
import { adminOnly, notFoundResponse } from "@/lib/api/guards";
import { audit, disconnect, findConnection, readSecretJson } from "@/lib/connections/store";
import { isRegion, type PostHogCredentials } from "@/lib/posthog/client";
import { choosePosthogProject, parsePosthogConfig, savePosthogCredentials } from "@/lib/posthog/connection";
import { revokePosthog } from "@/lib/posthog/oauth";
import { posthogSync } from "@/lib/posthog/sync";

type Ctx = { params: Promise<{ appId: string }> };
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

async function editable(appId: string) {
  const ctx = await appById(appId);
  if (!ctx) return { res: notFoundResponse() } as const;
  const denied = adminOnly(ctx);
  if (denied) return { res: denied } as const;
  return { ctx, scope: { orgId: ctx.org.id, projectId: ctx.project.id, userId: ctx.userId } } as const;
}

export async function POST(req: Request, { params }: Ctx) {
  const r = await editable((await params).appId);
  if ("res" in r) return r.res;
  const body = (await req.json().catch(() => null)) as { region?: unknown; key?: unknown } | null;
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  const region = body?.region ?? "us";
  if (!isRegion(region)) return bad("Pick the US or EU PostHog cloud.");
  if (!/^phx_[A-Za-z0-9_-]{20,}$/.test(key)) return bad("Paste a personal API key. It starts with phx_ and is made in PostHog under Settings, Personal API keys.");
  const saved = await savePosthogCredentials(r.scope, region, { kind: "key", key });
  if (!saved.ok) return bad(saved.error);
  if (saved.connected) after(() => posthogSync(r.scope.projectId).then(() => undefined));
  return NextResponse.json(saved);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const r = await editable((await params).appId);
  if ("res" in r) return r.res;
  const body = (await req.json().catch(() => null)) as { project_id?: unknown } | null;
  const id = Number(body?.project_id);
  if (!Number.isInteger(id) || id <= 0) return bad("Pick a PostHog project.");
  const chosen = await choosePosthogProject(r.scope, id);
  if (!chosen.ok) return bad(chosen.error);
  after(() => posthogSync(r.scope.projectId).then(() => undefined));
  return NextResponse.json(chosen);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const r = await editable((await params).appId);
  if ("res" in r) return r.res;
  const conn = await findConnection("posthog", { orgId: r.scope.orgId, projectId: r.scope.projectId });
  if (conn) {
    const config = parsePosthogConfig(conn.config);
    const creds = await readSecretJson<PostHogCredentials & Record<string, unknown>>(conn.id).catch(() => null);
    if (config && creds) await revokePosthog(config.region, creds);
    await disconnect(conn.id);
  }
  await audit({ orgId: r.scope.orgId, projectId: r.scope.projectId, actorId: r.scope.userId, action: "connection.disconnected", target: "posthog" });
  return NextResponse.json({ ok: true });
}
