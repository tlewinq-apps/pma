// The company's Claude API key. POST checks the key with Anthropic (the models list and a one-token call) before it is
// kept in Vault, and feedback that waited for it goes back in the queue; DELETE forgets it. Owners and admins only; the
// key is never sent back, logged or stored in a row.
import { NextResponse } from "next/server";
import { appById } from "@/lib/db/app";
import { adminOnly, notFoundResponse } from "@/lib/api/guards";
import { audit, disconnect, findConnection, last4, putSecret, saveConnection } from "@/lib/connections/store";
import { forgetClaudeKeys, requeueKeylessFeedback, verifyClaudeKey } from "@/lib/connections/claude";

type Ctx = { params: Promise<{ appId: string }> };
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

async function editable(appId: string) {
  const ctx = await appById(appId);
  if (!ctx) return { res: notFoundResponse() } as const;
  const denied = adminOnly(ctx);
  if (denied) return { res: denied } as const;
  if (ctx.project.kind === "demo") return { res: bad("The demo runs on PMA's own Claude key.") } as const;
  return { ctx } as const;
}

export async function POST(req: Request, { params }: Ctx) {
  const r = await editable((await params).appId);
  if ("res" in r) return r.res;
  const { ctx } = r;
  const body = (await req.json().catch(() => null)) as { key?: unknown } | null;
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  if (!key) return bad("Paste your Claude API key.");
  const check = await verifyClaudeKey(key);
  if (!check.ok) return bad(check.error);
  const scope = { orgId: ctx.org.id, projectId: null };
  const conn = await saveConnection("anthropic", scope, { status: "pending", display: { last4: last4(key) }, userId: ctx.userId });
  await putSecret(conn.id, key);
  await saveConnection("anthropic", scope, { status: "ok", verified: true, userId: ctx.userId });
  forgetClaudeKeys(ctx.org.id);
  await audit({ orgId: ctx.org.id, projectId: ctx.project.id, actorId: ctx.userId, action: "connection.connected", target: "anthropic", detail: { last4: last4(key) } });
  // Feedback that arrived before the key (a self-serve company's) waits as failed; it goes back in the queue now.
  await requeueKeylessFeedback(ctx.org.id).catch((e: Error) => console.error("[claude] requeue failed", e.message));
  return NextResponse.json({ ok: true, last4: last4(key) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const r = await editable((await params).appId);
  if ("res" in r) return r.res;
  const { ctx } = r;
  const conn = await findConnection("anthropic", { orgId: ctx.org.id, projectId: null });
  if (conn) await disconnect(conn.id);
  forgetClaudeKeys(ctx.org.id);
  await audit({ orgId: ctx.org.id, projectId: ctx.project.id, actorId: ctx.userId, action: "connection.disconnected", target: "anthropic" });
  return NextResponse.json({ ok: true });
}
