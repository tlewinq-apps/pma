// src/lib/db/invites.ts
// Looks up an invite by its raw token for the /invite and /join pages and their actions. The invite tables are
// server-only (no anon or authenticated grants), so this reads them with the service role, by token hash only: the
// token in the URL is the credential, and nothing a browser sends can name an invite any other way.
import { hashToken, inviteProblem, type InviteCode } from "@/lib/invites";
import { serviceDb } from "./server";

export type CompanyInvite = { id: string; email: string | null };
export type MemberInvite = { id: string; email: string; orgName: string };

type Found<T> = { invite: T; problem: null } | { invite: null; problem: InviteCode };

/** Tokens are 43 url-safe characters; anything far longer is not worth hashing. */
const plausible = (token: string) => token.length > 0 && token.length <= 200;

/** The company invite for this token, or why it can't be used. Throws when the lookup itself fails (an outage, not a bad link). */
export async function companyInviteByToken(token: string): Promise<Found<CompanyInvite>> {
  if (!plausible(token)) return { invite: null, problem: "invite_not_found" };
  const { data, error } = await serviceDb()
    .from("company_invites")
    .select("id, email, expires_at, consumed_at, revoked_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (error) throw new Error(`company invite lookup failed: ${error.message}`);
  const problem = inviteProblem(data && { used_at: data.consumed_at, revoked_at: data.revoked_at, expires_at: data.expires_at });
  return problem ? { invite: null, problem } : { invite: { id: data!.id as string, email: (data!.email as string | null) ?? null }, problem: null };
}

/** The member invite for this token with its company's name, or why it can't be used. A deleted company reads as withdrawn, as in accept_member_invite. */
export async function memberInviteByToken(token: string): Promise<Found<MemberInvite>> {
  if (!plausible(token)) return { invite: null, problem: "invite_not_found" };
  const { data, error } = await serviceDb()
    .from("member_invites")
    .select("id, email, expires_at, accepted_at, revoked_at, organizations!inner(name, deleted_at)")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (error) throw new Error(`member invite lookup failed: ${error.message}`);
  const org = data?.organizations as unknown as { name: string; deleted_at: string | null } | undefined;
  const problem = inviteProblem(data && { used_at: data.accepted_at, revoked_at: data.revoked_at, expires_at: data.expires_at })
    ?? (org?.deleted_at ? "invite_revoked" : null);
  return problem ? { invite: null, problem } : { invite: { id: data!.id as string, email: data!.email as string, orgName: org!.name }, problem: null };
}

/**
 * The company invite the signed-in person can still finish from their claim, by their own auth email (never an address
 * from the browser): the claim is unexpired, its invite is pending (unused, not revoked, unexpired) and, if it names an
 * address, names theirs. create_org_from_claim checks all of it again. Throws when the lookup itself fails.
 */
export async function liveClaimFor(email: string): Promise<{ inviteId: string } | null> {
  const address = email.trim().toLowerCase();
  if (!address) return null;
  const { data, error } = await serviceDb()
    .from("invite_claims")
    .select("expires_at, company_invites!inner(id, email, expires_at, consumed_at, revoked_at)")
    .eq("email", address)
    .maybeSingle();
  if (error) throw new Error(`invite claim lookup failed: ${error.message}`);
  if (!data || Date.parse(data.expires_at as string) <= Date.now()) return null;
  const inv = data.company_invites as unknown as { id: string; email: string | null; expires_at: string; consumed_at: string | null; revoked_at: string | null };
  if (inviteProblem({ used_at: inv.consumed_at, revoked_at: inv.revoked_at, expires_at: inv.expires_at })) return null;
  if (inv.email && inv.email.toLowerCase() !== address) return null;
  return { inviteId: inv.id };
}
