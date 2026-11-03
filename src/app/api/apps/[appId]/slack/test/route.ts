import { NextResponse } from "next/server";
import { appById } from "@/lib/db/app";
import { adminOnly, notFoundResponse } from "@/lib/api/guards";
import { postSlack } from "@/lib/slack/notify";

export async function POST(_req: Request, { params }: { params: Promise<{ appId: string }> }) {
  const ctx = await appById((await params).appId);
  if (!ctx) return notFoundResponse();
  const denied = adminOnly(ctx);
  if (denied) return denied;
  const { project } = ctx;
  if (!project.slack_webhook_url) return NextResponse.json({ error: "No webhook saved" }, { status: 400 });
  try {
    await postSlack(project.slack_webhook_url, [{ type: "section", text: { type: "mrkdwn", text: "PMA is connected." } }], "PMA test");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
