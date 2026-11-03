// The copy for a bad invite link and for a sign-in link that can't be sent. Kept apart from the token hash in invites.ts (which
// needs node:crypto) so the browser sign-in form can import it; invites.ts re-exports all of it.
import { SLUG_MESSAGES } from "@/lib/links";

export type InviteCode = "invite_used" | "invite_expired" | "invite_revoked" | "invite_not_found" | "invite_email";

/** Why an invite link can't be used, keyed by the reason code the invite RPCs raise (supabase/migrations/0018_orgs.sql). */
export const INVITE_MESSAGES: Record<InviteCode, string> = {
  invite_used: "This invite link was already used. Ask for a new one.",
  invite_expired: "This invite link has expired. Ask for a new one.",
  invite_revoked: "This invite link was withdrawn.",
  invite_not_found: "This invite link isn't valid. Check you copied all of it.",
  invite_email: "This invite is for a different email address. Sign in with the address it was sent to.",
};

export const GENERIC_INVITE_ERROR = "Something went wrong. Try the link again.";
/** /invite/continue with no claim left to finish from (used, expired, or never made for this address). */
export const CLAIM_MISSING = "There's no company invite waiting for this address any more. Open your invite link again, or ask for a new one.";

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * The sentence to show for an error from create_org_from_invite or accept_member_invite. The RPCs raise the reason code
 * as the whole message; anything else (another code, a network failure) gets the generic sentence, never the raw text.
 */
export function inviteError(e: unknown): string {
  const message = e && typeof e === "object" && "message" in e ? (e as { message: unknown }).message : null;
  if (typeof message !== "string") return GENERIC_INVITE_ERROR;
  if (has(INVITE_MESSAGES, message)) return INVITE_MESSAGES[message as InviteCode];
  if (has(SLUG_MESSAGES, message)) return SLUG_MESSAGES[message as keyof typeof SLUG_MESSAGES];
  return GENERIC_INVITE_ERROR;
}
