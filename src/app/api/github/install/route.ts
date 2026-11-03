// "Connect with GitHub": GET /api/github/install?app=<appId>&return=<path>. An owner or admin of the app's company is
// sent to GitHub's page for installing the PMA app and choosing repositories. GitHub comes back to /api/github/setup;
// a cookie carries the state there, since GitHub may not echo it. Anyone else gets the same 404 or 403 as every route.
import { NextResponse } from "next/server";
import { appById } from "@/lib/db/app";
import { adminOnly, notFoundResponse } from "@/lib/api/guards";
import { backTo, safeReturnTo, startOAuth } from "@/lib/connections/oauth";
import { githubAppEnabled } from "@/lib/github/app";
import { githubInstallUrl, INSTALL_COOKIE } from "@/lib/github/install";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ctx = await appById(url.searchParams.get("app") ?? "");
  if (!ctx) return notFoundResponse();
  const denied = adminOnly(ctx);
  if (denied) return denied;
  const returnTo = safeReturnTo(url.searchParams.get("return")) ?? `${ctx.base}/settings#repository`;
  const back = (error: string) => NextResponse.redirect(new URL(backTo(returnTo, returnTo, { connect: "github", error }), url));
  if (!githubAppEnabled()) return back("not_configured");
  if (ctx.project.kind === "demo") return back("demo");
  const { state } = await startOAuth({ provider: "github", orgId: ctx.org.id, projectId: ctx.project.id, userId: ctx.userId, returnTo });
  const res = NextResponse.redirect(githubInstallUrl(state));
  res.cookies.set(INSTALL_COOKIE, state, { httpOnly: true, secure: url.protocol === "https:", sameSite: "lax", path: "/api/github", maxAge: 600 });
  return res;
}
