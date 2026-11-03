// Invite links, for the invite pages, their actions and the tests: the copy (from inviteCopy.ts, which the browser can
// import) and the token hash. Pure: no database, no request.
import { createHash } from "node:crypto";
import type { InviteCode } from "@/lib/inviteCopy";

export { CLAIM_MISSING, INVITE_MESSAGES, GENERIC_INVITE_ERROR, inviteError, type InviteCode } from "@/lib/inviteCopy";

/** The stored form of an invite token: sha256 hex, the same as encode(extensions.digest(token, 'sha256'), 'hex'). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The fields of a company or member invite that decide whether it can still be used. used_at is consumed_at or accepted_at. */
export type InviteState = { used_at: string | null; revoked_at: string | null; expires_at: string };

/** Why this invite can't be used, checked in the same order as the RPCs, or null when it can. */
export function inviteProblem(row: InviteState | null, now: number = Date.now()): InviteCode | null {
  if (!row) return "invite_not_found";
  if (row.used_at) return "invite_used";
  if (row.revoked_at) return "invite_revoked";
  if (Date.parse(row.expires_at) <= now) return "invite_expired";
  return null;
}

/** An email address of the shape invite_member accepts (something@something.tld, no spaces), at most 254 characters. */
export function isEmail(email: string): boolean {
  return email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}
