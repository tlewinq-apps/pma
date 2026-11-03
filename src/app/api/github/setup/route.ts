// GitHub's setup URL: after the PMA app is installed (or its repositories changed), GitHub sends the person here with
// installation_id. That id is only a claim, so nothing is saved yet: the hand-off started at /api/github/install must be
// this person's, and then they sign in with GitHub (PKCE) so /api/github/callback can check the installation is theirs.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/db/app";
import { backTo, startOAuth, takeOAuth } from "@/lib/connections/oauth";
import { githubAuthorizeUrl, INSTALL_COOKIE } from "@/lib/github/install";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const user = await requireUser();
  const jar = await cookies();
  const taken = await takeOAuth("github", url.searchParams.get("state") ?? jar.get(INSTALL_COOKIE)?.value ?? null, user.userId);
  const done = (res: NextResponse) => { res.cookies.delete({ name: INSTALL_COOKIE, path: "/api/github" }); return res; };
  if (!taken.ok) return done(NextResponse.redirect(new URL(backTo(null, "/", { connect: "github", error: taken.reason }), url)));
  const s = taken.state;
  const back = (error: string) => done(NextResponse.redirect(new URL(backTo(s.return_to, s.return_to ?? "/", { connect: "github", error }), url)));
  // An organization member without the right to install asked its owners to approve; nothing to connect yet.
  if (url.searchParams.get("setup_action") === "request") return back("requested");
  const installationId = url.searchParams.get("installation_id") ?? "";
  if (!/^\d{1,20}$/.test(installationId)) return back("failed");
  const next = await startOAuth({ provider: "github", orgId: s.org_id, projectId: s.project_id, userId: user.userId, returnTo: s.return_to, pkce: true, data: { installation_id: installationId } });
  return done(NextResponse.redirect(githubAuthorizeUrl(next.state, next.challenge!)));
}
