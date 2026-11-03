"use server";
// The members page's actions. Each is a public POST endpoint, so each looks up the caller's own role in the company
// first: someone outside it gets a 404 (the same as the page), and someone without the right role gets a plain
// sentence. The RPCs check the role again (0018_orgs.sql, 0020_member_invite_admin.sql) and keep the last owner.
import { notFound, redirect } from "next/navigation";
import { refresh } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { isEmail } from "@/lib/invites";
import { userDb } from "@/lib/db/server";
import type { Role } from "@/lib/db/app";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES: readonly Role[] = ["owner", "admin", "member"];
const GENERIC = "Something went wrong. Try again.";
const OWNERS_ONLY = "Only company owners can change this.";
const OWNERS_AND_ADMINS = "Only company owners and admins can change this.";

/** The sentence for each reason code the member RPCs raise. "forbidden" depends on the action, so it is passed in. */
const MESSAGES: Record<string, string> = {
  last_owner: "A company needs at least one owner. Make someone else an owner first.",
  already_member: "That person is already in the company.",
  invalid_email: "Enter a valid email address.",
  not_member: "That person is no longer in the company.",
  invite_used: "That invite was already accepted.",
  invite_revoked: "That invite was already withdrawn.",
};

type Result = { error: string } | null;

function sentence(error: { message: string }, forbidden: string): string {
  if (error.message === "forbidden") return forbidden;
  return Object.prototype.hasOwnProperty.call(MESSAGES, error.message) ? MESSAGES[error.message] : GENERIC;
}

/** The signed-in caller and their role in the company. Signed out goes to sign-in; not in the company is a 404. */
async function caller(orgId: string): Promise<{ db: SupabaseClient; userId: string; role: Role }> {
  const db = await userDb();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/sign-in");
  if (typeof orgId !== "string" || !UUID.test(orgId)) notFound();
  const { data, error } = await db.from("org_members").select("role").eq("org_id", orgId).eq("user_id", user.id).maybeSingle();
  if (error) throw new Error(`membership lookup failed: ${error.message}`);
  if (!data) notFound();
  return { db, userId: user.id, role: data.role as Role };
}

/**
 * Owners and admins make an invite link for a teammate. PMA sends no email: the inviter copies the link and sends it.
 * The address labels the pending invite. Tokens are never logged.
 */
export async function inviteTeammate(orgId: string, email: string, role: "admin" | "member"): Promise<{ link: string } | { error: string }> {
  const me = await caller(orgId);
  if (me.role === "member") return { error: OWNERS_AND_ADMINS };
  const address = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!isEmail(address)) return { error: MESSAGES.invalid_email };
  if (role !== "admin" && role !== "member") return { error: GENERIC };

  const { data: token, error } = await me.db.rpc("invite_member", { p_org: orgId, p_email: address, p_role: role });
  if (error) return { error: sentence(error, OWNERS_AND_ADMINS) };
  if (typeof token !== "string") return { error: GENERIC };

  refresh();
  return { link: `${env.appUrl()}/join/${token}` };
}

/** Owners change a member's role (their own too, while another owner remains). */
export async function changeRole(orgId: string, userId: string, role: Role): Promise<Result> {
  const me = await caller(orgId);
  if (me.role !== "owner") return { error: OWNERS_ONLY };
  if (typeof userId !== "string" || !UUID.test(userId) || !ROLES.includes(role)) return { error: GENERIC };
  const { error } = await me.db.rpc("set_member_role", { p_org: orgId, p_user: userId, p_role: role });
  if (error) return { error: sentence(error, OWNERS_ONLY) };
  refresh();
  return null;
}

/** Owners remove a member. An owner who removes themselves (another owner remains) leaves for wherever "/" takes them. */
export async function removeMember(orgId: string, userId: string): Promise<Result> {
  const me = await caller(orgId);
  if (me.role !== "owner") return { error: OWNERS_ONLY };
  if (typeof userId !== "string" || !UUID.test(userId)) return { error: GENERIC };
  const { error } = await me.db.rpc("remove_member", { p_org: orgId, p_user: userId });
  if (error) return { error: sentence(error, OWNERS_ONLY) };
  if (userId === me.userId) redirect("/");
  refresh();
  return null;
}

/** Owners and admins withdraw a pending invite; its link then says it was withdrawn. */
export async function revokeMemberInvite(orgId: string, inviteId: string): Promise<Result> {
  const me = await caller(orgId);
  if (me.role === "member") return { error: OWNERS_AND_ADMINS };
  if (typeof inviteId !== "string" || !UUID.test(inviteId)) return { error: GENERIC };
  const { error } = await me.db.rpc("revoke_member_invite", { p_invite: inviteId });
  if (error) return { error: sentence(error, OWNERS_AND_ADMINS) };
  refresh();
  return null;
}

/**
 * Owners and admins replace a pending invite's link, since only its hash is stored and the old link can't be shown
 * again. The old link stops working, and the invite lasts seven more days.
 */
export async function rotateMemberInvite(orgId: string, inviteId: string): Promise<{ link: string } | { error: string }> {
  const me = await caller(orgId);
  if (me.role === "member") return { error: OWNERS_AND_ADMINS };
  if (typeof inviteId !== "string" || !UUID.test(inviteId)) return { error: GENERIC };
  const { data: token, error } = await me.db.rpc("rotate_member_invite", { p_invite: inviteId });
  if (error) return { error: sentence(error, OWNERS_AND_ADMINS) };
  if (typeof token !== "string") return { error: GENERIC };
  refresh();
  return { link: `${env.appUrl()}/join/${token}` };
}
