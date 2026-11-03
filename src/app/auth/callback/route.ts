import { NextResponse } from "next/server";
import { userDb } from "@/lib/db/server";
import { isCallbackOtpType } from "@/lib/authLink";
import { lastAppHref } from "@/lib/db/app";
import { safeNext } from "@/lib/links";

/**
 * Where a sign-in link lands. Signs the person in, then sends them to the page they came for (a same-site ?next, such
 * as their invite link), else to the app they last opened, else to /no-company. It grants nothing: companies are
 * created and joined only from invite links.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const db = await userDb();
  // PKCE links carry ?code; token_hash links (Supabase's SSR email template, admin-generated links) carry ?token_hash&type.
  const { data, error } = code
    ? await db.auth.exchangeCodeForSession(code)
    : tokenHash && isCallbackOtpType(type)
      ? await db.auth.verifyOtp({ token_hash: tokenHash, type })
      : { data: { user: null }, error: new Error("missing code") };
  if (error || !data.user) return NextResponse.redirect(new URL("/sign-in?error=link", url));

  const next = safeNext(url.searchParams.get("next"));
  if (next) return NextResponse.redirect(new URL(next, url));
  return NextResponse.redirect(new URL((await lastAppHref()) ?? "/no-company", url));
}
