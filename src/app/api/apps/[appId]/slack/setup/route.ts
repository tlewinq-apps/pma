import { NextResponse, after } from "next/server";
import { appById } from "@/lib/db/app";
import { adminOnly, notFoundResponse } from "@/lib/api/guards";
import { validPrefix } from "@/lib/slack/cards";
import { createChannels, listChannels, slackStatus, pickChannels } from "@/lib/slack/setup";
import { slackForProject } from "@/lib/slack/tenant";

export const maxDuration = 300;

type Ctx = { params: Promise<{ appId: string }> };
const CHANNEL_ID = /^[CG][A-Z0-9]{6,20}$/;

/** The app's Slack status; with ?channels=1 also the channels an admin can pick (public, or private with PMA in them). */
export async function GET(req: Request, { params }: Ctx) {
  const ctx = await appById((await params).appId);
  if (!ctx) return notFoundResponse();
  const denied = adminOnly(ctx);
  if (denied) return denied;
  const status = await slackStatus(ctx.project.id);
  if (new URL(req.url).searchParams.get("channels") !== "1") return NextResponse.json(status);
  return NextResponse.json({ ...status, options: (await listChannels(ctx.project.id).catch(() => null)) ?? [] });
}

/**
 * Sets up the app's channels in its own workspace: `{ prefix }` creates them (or reuses public ones with the same
 * names) and invites you; `{ inbox, cards }` uses channels you picked. Then cards for open issues are posted in the
 * background. Each app has its own channels, so one company's setup never touches another's.
 */
export async function POST(req: Request, { params }: Ctx) {
  const ctx = await appById((await params).appId);
  if (!ctx) return notFoundResponse();
  const denied = adminOnly(ctx);
  if (denied) return denied;
  if (!(await slackForProject(ctx.project.id))) {
    return NextResponse.json({ error: ctx.project.kind === "demo" ? "Add SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET first, then restart the app." : "Connect to Slack first." }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as { prefix?: unknown; inbox?: unknown; cards?: unknown };
  let r: { ok: true } | { ok: false; error: string };
  if (body.inbox !== undefined || body.cards !== undefined) {
    if (typeof body.inbox !== "string" || typeof body.cards !== "string" || !CHANNEL_ID.test(body.inbox) || !CHANNEL_ID.test(body.cards)) {
      return NextResponse.json({ error: "Pick a channel for feedback and one for the cards." }, { status: 400 });
    }
    r = await pickChannels(ctx.project.id, { inbox: body.inbox, cards: body.cards }, ctx.email || null);
  } else {
    const prefix = body.prefix === undefined ? (ctx.project.kind === "demo" ? "pma" : ctx.project.slug) : body.prefix;
    if (typeof prefix !== "string" || !validPrefix(prefix)) return NextResponse.json({ error: "Use lowercase letters, numbers, - or _ for the prefix." }, { status: 400 });
    r = await createChannels(ctx.project.id, prefix, ctx.email || null);
  }
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  const projectId = ctx.project.id;
  after(async () => { const { sweepSlack } = await import("@/lib/slack/sync"); await sweepSlack(40, projectId); });
  return NextResponse.json(await slackStatus(projectId));
}
