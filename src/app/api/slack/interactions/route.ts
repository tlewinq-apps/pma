import { NextResponse, after } from "next/server";
import { verifySlackSignature } from "@/lib/slack/verify";
import { parseInteraction, teamOf } from "@/lib/slack/interactions";

export const maxDuration = 300;
const ok = () => new NextResponse(null, { status: 200 });

/**
 * Slack interactivity: buttons, form submissions and the "Send to PMA" shortcut. The raw body is verified before
 * parsing (the signature covers it). Each payload names its workspace (team), and everything runs in that workspace
 * (withSlack): a click from a workspace no company has connected does nothing. Forms open before the acknowledgement
 * because their trigger_id expires in 3 s; submissions answer with inline errors; everything else acknowledges and runs
 * in after().
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return NextResponse.json({ error: "SLACK_SIGNING_SECRET is not set" }, { status: 503 });
  if (!verifySlackSignature(secret, raw, req.headers.get("x-slack-request-timestamp"), req.headers.get("x-slack-signature"))) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  let payload: unknown = null;
  try { payload = JSON.parse(new URLSearchParams(raw).get("payload") ?? "null"); } catch { return NextResponse.json({ error: "bad payload" }, { status: 400 }); }
  const it = parseInteraction(payload);
  if (it.kind === "ignore") return ok();
  const [{ slackForTeam }, { withSlack }] = await Promise.all([import("@/lib/slack/tenant"), import("@/lib/slack/context")]);
  const slack = await slackForTeam(teamOf(payload));
  if (!slack) return ok();
  const h = await import("@/lib/slack/handlers");
  switch (it.kind) {
    case "open_write": case "open_edit": case "open_changes":
      await withSlack(slack, () => h.openModal(it));
      return ok();
    case "submit_write": case "submit_edit": case "submit_changes": {
      const errors = await withSlack(slack, () => h.handleSubmission(it));
      return errors ? NextResponse.json({ response_action: "errors", errors }) : ok();
    }
    default:
      after(() => withSlack(slack, () => h.handleAction(it)));
      return ok();
  }
}
