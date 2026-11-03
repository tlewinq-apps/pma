"use server";
// The company invite's actions. Each one is a public POST endpoint, so each re-checks the invite from the token (never
// an id from the browser) and, when it acts as the user, the session.
import { redirect } from "next/navigation";
import { companyInviteByToken } from "@/lib/db/invites";
import { userDb } from "@/lib/db/server";
import { GENERIC_INVITE_ERROR, INVITE_MESSAGES, inviteError } from "@/lib/invites";
import { appBase } from "@/lib/links";
import { companyRpcArgs, parseCompanyForm, type CreateResult } from "@/lib/companyForm";

/**
 * Signed in: create the company and its first app from the invite, as the user (create_org_from_invite checks the
 * invite, the address and the slugs again and makes them the owner), then open the app's welcome tour.
 */
export async function createCompany(token: string, form: FormData): Promise<CreateResult> {
  if (typeof token !== "string" || !(form instanceof FormData)) return { error: GENERIC_INVITE_ERROR };
  const db = await userDb();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect(`/invite/${encodeURIComponent(token)}`); // signed out since the page loaded: show the sign-in button

  const { invite, problem } = await companyInviteByToken(token);
  if (problem) return { error: INVITE_MESSAGES[problem] };
  if (invite.email && invite.email.toLowerCase() !== (user.email ?? "").toLowerCase()) return { error: INVITE_MESSAGES.invite_email };

  const fields = parseCompanyForm(form);
  if (!fields.ok) return { error: fields.error, field: fields.field };

  const { data, error } = await db.rpc("create_org_from_invite", { p_token: token, ...companyRpcArgs(fields.value) });
  // A new company has no apps, so a taken slug can only be the company's.
  if (error) return { error: inviteError(error), ...(error.message === "slug_taken" ? { field: "orgSlug" as const } : {}) };
  const row = (Array.isArray(data) ? data[0] : data) as { org_slug: string; app_slug: string } | undefined;
  if (!row) return { error: GENERIC_INVITE_ERROR };
  redirect(`${appBase(row.org_slug, row.app_slug)}/welcome?tour=1`);
}
