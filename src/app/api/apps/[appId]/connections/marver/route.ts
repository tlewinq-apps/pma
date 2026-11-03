// Connect to Marver: an existing canvas in a repository the app can read. POST { repo?, branch?, path? } checks the
// manifest, saves where the canvas is, and syncs its screens and flows; DELETE stops reading it (screens already synced
// stay, so issues keep their screens). Owners and admins only; the demo keeps its built-in canvas.
import { NextResponse } from "next/server";
import { appById } from "@/lib/db/app";
import { adminOnly, notFoundResponse } from "@/lib/api/guards";
import { serviceDb } from "@/lib/db/server";
import { audit, disconnect, findConnection, markConnection, saveConnection } from "@/lib/connections/store";
import { canvasLocation, checkCanvas } from "@/lib/marver/connect";
import { syncScreens } from "@/lib/marver/sync";
import { RepoFetchError, RepoPathError } from "@/lib/repo/snapshot";

export const maxDuration = 120;
type Ctx = { params: Promise<{ appId: string }> };
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

async function editable(appId: string) {
  const ctx = await appById(appId);
  if (!ctx) return { res: notFoundResponse() } as const;
  const denied = adminOnly(ctx);
  if (denied) return { res: denied } as const;
  if (ctx.project.kind === "demo") return { res: bad("The demo uses its built-in Celeste canvas.") } as const;
  return { ctx } as const;
}

export async function POST(req: Request, { params }: Ctx) {
  const r = await editable((await params).appId);
  if ("res" in r) return r.res;
  const { ctx } = r;
  const loc = canvasLocation((await req.json().catch(() => ({}))) ?? {}, ctx.project);
  if ("error" in loc) return bad(loc.error);
  let check;
  try {
    check = await checkCanvas(loc, undefined, ctx.org.id);
  } catch (e) {
    if (e instanceof RepoFetchError || e instanceof RepoPathError) return bad(e.message, e instanceof RepoFetchError ? 502 : 400);
    throw e;
  }
  if (!check.ok) return bad(check.error);
  const scope = { orgId: ctx.org.id, projectId: ctx.project.id };
  const conn = await saveConnection("marver", scope, {
    status: "ok", display: { repo: loc.repo, branch: loc.branch, path: loc.path, frames: check.frames }, config: { ...loc }, externalId: `${loc.repo}:${loc.path}`, verified: true, userId: ctx.userId,
  });
  // The canvas folder is also the app's design path, which drafting and screen links read.
  await serviceDb().from("projects").update({ design_path: loc.path }).eq("id", ctx.project.id);
  await audit({ orgId: ctx.org.id, projectId: ctx.project.id, actorId: ctx.userId, action: "connection.connected", target: "marver", detail: { repo: loc.repo, path: loc.path } });
  try {
    const synced = await syncScreens(ctx.project.id);
    await saveConnection("marver", scope, { status: "ok", display: { repo: loc.repo, branch: loc.branch, path: loc.path, frames: check.frames, screens: synced.count, flows: synced.flows } });
    return NextResponse.json({ ok: true, screens: synced.count, flows: synced.flows });
  } catch (e) {
    await markConnection(conn.id, "broken", (e as Error).message.slice(0, 300));
    return bad(`Connected, but the screens didn't sync: ${(e as Error).message}`, 502);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const r = await editable((await params).appId);
  if ("res" in r) return r.res;
  const { ctx } = r;
  const conn = await findConnection("marver", { orgId: ctx.org.id, projectId: ctx.project.id });
  if (conn) await disconnect(conn.id);
  await audit({ orgId: ctx.org.id, projectId: ctx.project.id, actorId: ctx.userId, action: "connection.disconnected", target: "marver" });
  return NextResponse.json({ ok: true });
}
