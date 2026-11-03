"use server";
// The member invite's actions. Each one is a public POST endpoint, so each re-checks the invite from the token (never
// an id from the browser) and, when it acts as the user, the session.
import { redirect } from "next/navigation";
import { myApps } from "@/lib/db/app";
import { userDb } from "@/lib/db/server";
import { GENERIC_INVITE_ERROR, inviteError } from "@/lib/invites";
import { appBase } from "@/lib/links";

/** Signed in: join the company as the user (accept_member_invite checks the invite), then open its first app's welcome tour. */
export async function joinCompany(token: string): Promise<{ error: string } | null> {
  if (typeof token !== "string") return { error: GENERIC_INVITE_ERROR };
  const db = await userDb();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect(`/join/${encodeURIComponent(token)}`); // signed out since the page loaded: show the sign-in button

  const { data, error } = await db.rpc("accept_member_invite", { p_token: token });
  if (error) return { error: inviteError(error) };
  const orgSlug = ((Array.isArray(data) ? data[0] : data) as { org_slug: string } | undefined)?.org_slug?.toLowerCase();
  const first = orgSlug ? (await myApps()).find((a) => a.org.slug.toLowerCase() === orgSlug) : undefined;
  redirect(first ? `${appBase(first.org.slug, first.app.slug)}/welcome?tour=1` : "/");
}
