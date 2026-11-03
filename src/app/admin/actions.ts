"use server";
// /admin's actions. Each is a public POST endpoint, so each first checks that the caller is a platform admin (as the
// signed-in user, through is_platform_admin) and answers anyone else with a 404, the same as the page. Only then does
// it touch company_invites, which has no grants for signed-in users and is written with the service role.
import { randomBytes } from "node:crypto";
import { notFound } from "next/navigation";
import { refresh } from "next/cache";
import { env } from "@/lib/env";
import { hashToken, isEmail } from "@/lib/invites";
import { serviceDb, userDb } from "@/lib/db/server";

export type InviteDays = 1 | 7 | 30;
const INVITE_DAYS: readonly InviteDays[] = [1, 7, 30];
const NOTE_MAX = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENERIC = "Something went wrong. Try again.";

/** The platform admin's user id. Anyone else (signed out included) gets a 404. */
async function requirePlatformAdmin(): Promise<string> {
  const db = await userDb();
  const { data: { user } } = await db.auth.getUser();
  if (!user) notFound();
  const { data, error } = await db.rpc("is_platform_admin");
  if (error) throw new Error(`platform admin check failed: ${error.message}`);
  if (data !== true) notFound();
  return user.id;
}

/**
 * Makes a company invite link and returns it. Only its hash is stored, so this is the one time the link is shown.
 * With an email, only that address can use it.
 */
export async function createCompanyInvite(form: { email?: string; note?: string; days: InviteDays }): Promise<{ link: string } | { error: string }> {
  const userId = await requirePlatformAdmin();
  const email = typeof form?.email === "string" ? form.email.trim().toLowerCase() : "";
  const note = typeof form?.note === "string" ? form.note.trim() : "";
  if (email && !isEmail(email)) return { error: "Enter a valid email address, or leave it empty for anyone with the link." };
  if (note.length > NOTE_MAX) return { error: `Keep the note under ${NOTE_MAX} characters.` };
  if (!INVITE_DAYS.includes(form?.days)) return { error: "Pick how long the link lasts." };

  const token = randomBytes(32).toString("base64url");
  const { error } = await serviceDb().from("company_invites").insert({
    token_hash: hashToken(token),
    email: email || null,
    note: note || null,
    created_by: userId,
    expires_at: new Date(Date.now() + form.days * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (error) {
    console.error("company invite insert failed:", error.message);
    return { error: GENERIC };
  }
  refresh();
  return { link: `${env.appUrl()}/invite/${token}` };
}

/** Withdraws a company invite that hasn't been used. Its link then says "This invite link was withdrawn." */
export async function revokeCompanyInvite(id: string): Promise<{ error: string } | null> {
  await requirePlatformAdmin();
  if (typeof id !== "string" || !UUID.test(id)) return { error: GENERIC };
  const { data, error } = await serviceDb()
    .from("company_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("consumed_at", null)
    .is("revoked_at", null)
    .select("id");
  if (error) {
    console.error("company invite revoke failed:", error.message);
    return { error: GENERIC };
  }
  refresh();
  return data.length ? null : { error: "That invite was already used or withdrawn." };
}
