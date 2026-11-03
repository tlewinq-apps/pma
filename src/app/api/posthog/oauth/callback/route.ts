// PostHog sends the person back here after consent. The state must be this deployment's, unexpired, unused and the
// same person's; the code is swapped (with the PKCE verifier) for a token pair kept in Vault. With one project picked
// it's checked and connected at once; otherwise the person lands back with &pick=1 to choose one.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/db/app";
import { backTo, takeOAuth } from "@/lib/connections/oauth";
import { isRegion } from "@/lib/posthog/client";
import { exchangePosthogCode } from "@/lib/posthog/oauth";
import { savePosthogCredentials } from "@/lib/posthog/connection";
import { posthogSync } from "@/lib/posthog/sync";
import { after } from "next/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const user = await requireUser();
  const taken = await takeOAuth("posthog", url.searchParams.get("state"), user.userId);
  if (!taken.ok) return NextResponse.redirect(new URL(backTo(null, "/", { connect: "posthog", error: taken.reason }), url));
  const { state } = taken;
  const back = (params: Record<string, string>) => NextResponse.redirect(new URL(backTo(state.return_to, state.return_to ?? "/", { connect: "posthog", ...params }), url));
  const region = state.data.region;
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code || !isRegion(region) || !state.code_verifier || !state.project_id) return back({ error: url.searchParams.get("error") ? "denied" : "failed" });
  try {
    const { creds, scopedProjects } = await exchangePosthogCode(region, code, state.code_verifier);
    const r = await savePosthogCredentials({ orgId: state.org_id, projectId: state.project_id, userId: user.userId }, region, creds, { scopedProjects });
    if (!r.ok) return back({ error: "failed" });
    if (!r.connected) return back({ pick: "1" });
    const projectId = state.project_id;
    after(() => posthogSync(projectId).then(() => undefined));
    return back({ ok: "1" });
  } catch (e) {
    console.error("[posthog] sign-in failed", (e as Error).message);
    return back({ error: "failed" });
  }
}
