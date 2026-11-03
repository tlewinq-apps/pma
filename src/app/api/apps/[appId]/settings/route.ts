import { NextResponse } from "next/server";
import { appById } from "@/lib/db/app";
import { adminOnly, notFoundResponse } from "@/lib/api/guards";
import { userDb } from "@/lib/db/server";
import { parseSettingsPatch } from "@/lib/settings";

export async function PATCH(req: Request, { params }: { params: Promise<{ appId: string }> }) {
  const ctx = await appById((await params).appId);
  if (!ctx) return notFoundResponse();
  const denied = adminOnly(ctx);
  if (denied) return denied;
  const parsed = parseSettingsPatch(await req.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { error } = await (await userDb()).from("projects").update(parsed.patch).eq("id", ctx.project.id);
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true });
}
