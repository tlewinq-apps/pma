import { NextResponse, after } from "next/server";
import { verifySlackSignature } from "@/lib/slack/verify";

export const maxDuration = 300;

/**
 * Slack Events API: messages in an app's channels, App Home opens, and the app being uninstalled or its token revoked.
 * Verifies the signature, acknowledges at once (Slack wants an answer within 3 s), and does the work in after(), routed
 * by the event's team_id. Retries are dropped: the first delivery is still running, and every write it makes is keyed
 * to the message.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  let body: { type?: string; challenge?: string; event?: unknown; team_id?: unknown; enterprise_id?: unknown };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const secret = process.env.SLACK_SIGNING_SECRET;
  // Creating the app from the manifest checks this URL before you can copy the signing secret; the challenge is harmless.
  if (!secret) return body.type === "url_verification" ? NextResponse.json({ challenge: body.challenge }) : NextResponse.json({ error: "SLACK_SIGNING_SECRET is not set" }, { status: 503 });
  if (!verifySlackSignature(secret, raw, req.headers.get("x-slack-request-timestamp"), req.headers.get("x-slack-signature"))) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  if (body.type === "url_verification") return NextResponse.json({ challenge: body.challenge });
  if (req.headers.get("x-slack-retry-num")) return new NextResponse(null, { status: 200 });
  if (body.type === "event_callback") {
    after(async () => (await import("@/lib/slack/eventHandlers")).handleEvent(body));
  }
  return new NextResponse(null, { status: 200 });
}
