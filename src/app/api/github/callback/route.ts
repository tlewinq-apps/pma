// GitHub's sign-in comes back here. The state must be the one /api/github/setup minted, for the same signed-in person;
// then the code (with its PKCE verifier) becomes the person's token, which is used once to check that the installation
// GitHub named is one they can see, and the installation is saved for their company. The token itself is not kept.
// When the installation was given exactly one repository, it is connected to the app at once.
// The person lands back where they started, with ?connect=github&ok=1 or &error=<reason>.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/db/app";
import { backTo, takeOAuth } from "@/lib/connections/oauth";
import { exchangeGithubCode, saveGithubInstallation } from "@/lib/github/install";
import { connectOnlyRepository } from "@/lib/github/autoConnect";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const user = await requireUser();
  const taken = await takeOAuth("github", url.searchParams.get("state"), user.userId);
  if (!taken.ok) return NextResponse.redirect(new URL(backTo(null, "/", { connect: "github", error: taken.reason }), url));
  const s = taken.state;
  const back = (params: Record<string, string>) => NextResponse.redirect(new URL(backTo(s.return_to, s.return_to ?? "/", { connect: "github", ...params }), url));
  if (url.searchParams.get("error")) return back({ error: "denied" }); // they pressed Cancel on GitHub's screen
  const code = url.searchParams.get("code");
  const installationId = typeof s.data.installation_id === "string" ? s.data.installation_id : "";
  if (!code || !installationId || !s.code_verifier) return back({ error: "failed" });
  try {
    const token = await exchangeGithubCode(code, s.code_verifier);
    const r = await saveGithubInstallation(installationId, token, { orgId: s.org_id, projectId: s.project_id, userId: user.userId });
    if (!r.ok) return back({ error: r.reason });
    await connectOnlyRepository(installationId, { orgId: s.org_id, projectId: s.project_id });
    return back({ ok: "1" });
  } catch (e) {
    console.error("[github] connect failed", (e as Error).message);
    return back({ error: "failed" });
  }
}
