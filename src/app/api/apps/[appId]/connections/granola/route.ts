// The company's Granola workspace. POST { key } checks the grn_ key and registers the webhook; PATCH {} makes this app
// the one new notes go to; DELETE removes the webhook and forgets the key. Owners and admins only. The key and the
// webhook's signing secret go to Vault and are never sent back.
import { NextResponse, after } from "next/server";
import { appById } from "@/lib/db/app";
import { adminOnly, notFoundResponse } from "@/lib/api/guards";
import { env } from "@/lib/env";
import { findConnection } from "@/lib/connections/store";
import { connectGranola, disconnectGranola, granolaCatchUp, setGranolaApp } from "@/lib/granola/notes";

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
  const body = (await req.json().catch(() => null)) as { key?: unknown } | null;
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  if (!key) return bad("Paste your Granola API key.");
  const res = await connectGranola(r.scope, key, { appUrl: env.appUrl() });
  if (!res.ok) return bad(res.error);
  // The last four days of notes come in now; after that, the webhook (or the daily catch-up).
  const conn = await findConnection("granola", { orgId: r.scope.orgId, projectId: null });
  if (conn) after(() => granolaCatchUp(conn.id).then(() => undefined));
  return NextResponse.json(res);
}

export async function PATCH(_req: Request, { params }: Ctx) {
  const r = await editable((await params).appId);
  if ("res" in r) return r.res;
  return (await setGranolaApp(r.scope, r.scope.projectId)) ? NextResponse.json({ ok: true }) : bad("Connect Granola first.");
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const r = await editable((await params).appId);
  if ("res" in r) return r.res;
  await disconnectGranola(r.scope);
  return NextResponse.json({ ok: true });
}
