// Sign-in links that land on /auth/callback with ?token_hash&type: the one-time links the e2e setup makes through the
// admin API (people sign in with GitHub, which lands with ?code). Pure, so the callback route and the tests agree on
// which token types are verified.
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * The token types the callback verifies. auth.admin.generateLink reports which one its token needs in
 * properties.verification_type: "magiclink" for a confirmed account, "signup" for an address that has never signed in
 * (a brand-new invitee), "invite" for an invite email, "email" for an email OTP.
 */
export const CALLBACK_OTP_TYPES: readonly EmailOtpType[] = ["magiclink", "email", "signup", "invite"];

export function isCallbackOtpType(v: unknown): v is EmailOtpType {
  return typeof v === "string" && (CALLBACK_OTP_TYPES as readonly string[]).includes(v);
}

/**
 * The /auth/callback link for a token from auth.admin.generateLink. The token is verified with the type Supabase made it
 * for (properties.verification_type), never an assumed "magiclink": a brand-new invitee's token is a "signup" token,
 * and verifying it as a magic link fails as "expired". `next` is a same-site path to land on afterwards.
 */
export function magicLinkUrl(appUrl: string, props: { hashed_token?: string | null; verification_type?: string | null }, next?: string): string {
  if (!props.hashed_token) throw new Error("No link came back");
  if (!isCallbackOtpType(props.verification_type)) throw new Error(`Supabase made a "${props.verification_type ?? "unknown"}" token, which /auth/callback doesn't verify`);
  const q = new URLSearchParams({ token_hash: props.hashed_token, type: props.verification_type });
  if (next) {
    if (!next.startsWith("/") || next.startsWith("//")) throw new Error("next must be a path on this site, such as /invite/abc");
    q.set("next", next);
  }
  return `${appUrl.replace(/\/+$/, "")}/auth/callback?${q.toString()}`;
}
