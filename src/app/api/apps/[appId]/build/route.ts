// The company's default answer to "How should this be built?" for this app (lib/handoff/build.ts), kept in
// projects.settings.build. Owners and admins only; settings has no UPDATE grant for signed-in users (0040), so the write
// goes through the service role after the membership and role checks, like the product profile route. A way PMA can't
// build for this company (a pull request without the PMA GitHub App's write access) is refused, so the default always
// works; "Add to an existing branch" keeps its branch. The demo app doesn't hand work off.
import { NextResponse } from "next/server";
import { appById } from "@/lib/db/app";
import { adminOnly, notFoundResponse } from "@/lib/api/guards";
import { serviceDb } from "@/lib/db/server";
import { BUILD_UNAVAILABLE, buildModeAvailable, parseBuildMode, withBuildDefault } from "@/lib/handoff/build";
import { isBranchName } from "@/lib/settings";
import { buildCaps } from "@/lib/build/start";

export async function PUT(req: Request, { params }: { params: Promise<{ appId: string }> }) {
  const ctx = await appById((await params).appId);
  if (!ctx) return notFoundResponse();
  const denied = adminOnly(ctx);
  if (denied) return denied;
  if (ctx.project.kind === "demo") return NextResponse.json({ error: "The demo app ships when its mock-up is approved, so it has no build default." }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { mode?: unknown; branch?: unknown } | null;
  const mode = parseBuildMode(body?.mode);
  if (!mode) return NextResponse.json({ error: "Pick how this should be built." }, { status: 400 });
  const branch = mode === "branch" && typeof body?.branch === "string" ? body.branch.trim() : null;
  if (mode === "branch" && (!branch || !isBranchName(branch))) return NextResponse.json({ error: "Name the branch to add the change to." }, { status: 400 });
  if (!buildModeAvailable(mode, await buildCaps(ctx.org.id))) return NextResponse.json({ error: BUILD_UNAVAILABLE }, { status: 409 });
  const db = serviceDb();
  // Read the settings again with the service role, so other keys saved since the page loaded are kept.
  const { data, error: readError } = await db.from("projects").select("settings").eq("id", ctx.project.id).single();
  if (readError) return NextResponse.json({ error: "Couldn't save the default. Try again." }, { status: 500 });
  const settings = withBuildDefault(data?.settings, mode, branch);
  const { error } = await db.from("projects").update({ settings }).eq("id", ctx.project.id);
  if (error) return NextResponse.json({ error: "Couldn't save the default. Try again." }, { status: 500 });
  return NextResponse.json({ ok: true, mode });
}
