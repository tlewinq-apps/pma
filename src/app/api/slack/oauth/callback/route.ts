// Slack sends the person back here after "Add to Slack". The state must be one this deployment minted, unexpired,
// unused, and started by the same signed-in person; then the code is swapped for the workspace's bot token
// (oauth.v2.access), which goes to Vault, and the workspace is tied to the company (one company per workspace).
// The person lands back where they started, with ?connect=slack&ok=1 or &error=<reason>.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/db/app";
import { backTo, takeOAuth } from "@/lib/connections/oauth";
import { exchangeSlackCode, saveInstallation } from "@/lib/slack/install";
import { SlackError } from "@/lib/slack/api";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const user = await requireUser();
  const taken = await takeOAuth("slack", url.searchParams.get("state"), user.userId);
  if (!taken.ok) return NextResponse.redirect(new URL(backTo(null, "/", { connect: "slack", error: taken.reason }), url));
  const { state } = taken;
  const home = state.return_to ?? "/";
  const back = (params: Record<string, string>) => NextResponse.redirect(new URL(backTo(state.return_to, home, { connect: "slack", ...params }), url));
  if (url.searchParams.get("error")) return back({ error: "denied" }); // they pressed Cancel on Slack's screen
  const code = url.searchParams.get("code");
  if (!code) return back({ error: "failed" });
  try {
    const access = await exchangeSlackCode(code);
    const r = await saveInstallation(access, { orgId: state.org_id, projectId: state.project_id, userId: user.userId });
    return r.ok ? back({ ok: "1" }) : back({ error: r.reason });
  } catch (e) {
    console.error("[slack] install failed", e instanceof SlackError ? e.code : (e as Error).message);
    return back({ error: "failed" });
  }
}
