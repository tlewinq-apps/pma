import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { signedOutResponse } from "@/lib/auth";

export async function proxy(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const db = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        // Propagate refreshed tokens to the request (so server components see them) and the response.
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  // Also refreshes an expired session and writes the new cookies, which a page or server action cannot always do.
  const { data: { user } } = await db.auth.getUser();
  const signedOut = user ? "pass" : signedOutResponse(req.nextUrl.pathname);
  if (signedOut !== "pass") {
    const denied = signedOut === "unauthorized"
      ? NextResponse.json({ error: "unauthorized" }, { status: 401 })
      : NextResponse.redirect(signInUrl(req));
    res.cookies.getAll().forEach((c) => denied.cookies.set(c));
    return denied;
  }
  return res;
}

/** /sign-in, carrying the page that was asked for (path and query) so the sign-in link brings the person back to it. */
function signInUrl(req: NextRequest): URL {
  const url = new URL("/sign-in", req.url);
  const next = req.nextUrl.pathname + req.nextUrl.search;
  if (next !== "/") url.searchParams.set("next", next);
  return url;
}

// Paths skipped here never reach the proxy, so each must be public in isPublicPath() (src/lib/auth.ts;
// tests/unit/auth.test.ts checks). /invite and /join are public but not skipped: the proxy refreshes their session and
// signedOutResponse lets signed-out visitors through. Must be a static literal for Next.
export const config = { matcher: ["/((?!(?:sign-in|auth|api/widget|api/cron|api/github/webhook|api/drafts/callback|api/v1|api/slack/events|api/slack/interactions|api/granola/webhook|oauth/posthog-client\\.json)(?:/|$)|widget\\.js$|favicon\\.ico$|_next/).*)"] };
