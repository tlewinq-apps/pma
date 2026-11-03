// The app's API key, for the Use PMA from Claude card in Settings. Owners and admins only, as with the whole Slack
// webhook URL: the key reads every issue and adds feedback on its own, and keeps working after whoever copied it leaves
// the company. The settings page never ships it; the card asks for it when someone presses Show key.
import { NextResponse } from "next/server";
import { appById, hasRole } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { KEY_FORBIDDEN } from "@/lib/mcp/connect";

export async function GET(_req: Request, { params }: { params: Promise<{ appId: string }> }) {
  const ctx = await appById((await params).appId);
  if (!ctx) return notFoundResponse();
  if (!hasRole(ctx, ["owner", "admin"])) return NextResponse.json({ error: KEY_FORBIDDEN }, { status: 403 });
  return NextResponse.json({ key: ctx.project.api_key }, { headers: { "cache-control": "no-store" } });
}
