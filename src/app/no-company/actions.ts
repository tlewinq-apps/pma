"use server";
// Setting up a company with no invite (open sign-up, /no-company). A public POST endpoint like every server action, so
// it acts only as the session's user: create_org_open checks they're signed in and in no company yet, then applies the
// same slug checks as the invite ways in.
import { redirect } from "next/navigation";
import { userDb } from "@/lib/db/server";
import { GENERIC_INVITE_ERROR, inviteError } from "@/lib/invites";
import { appBase } from "@/lib/links";
import { companyRpcArgs, parseCompanyForm, type CreateResult } from "@/lib/companyForm";

export async function createCompanyOpen(form: FormData): Promise<CreateResult> {
  if (!(form instanceof FormData)) return { error: GENERIC_INVITE_ERROR };
  const db = await userDb();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/sign-in?next=%2Fno-company");

  const fields = parseCompanyForm(form);
  if (!fields.ok) return { error: fields.error, field: fields.field };

  const { data, error } = await db.rpc("create_org_open", companyRpcArgs(fields.value));
  // Already in a company (set up in another tab, or an invite accepted meanwhile): go there.
  if (error?.message === "already_in_company") redirect("/");
  // A new company has no apps, so a taken slug can only be the company's.
  if (error) return { error: inviteError(error), ...(error.message === "slug_taken" ? { field: "orgSlug" as const } : {}) };
  const row = (Array.isArray(data) ? data[0] : data) as { org_slug: string; app_slug: string } | undefined;
  if (!row) return { error: GENERIC_INVITE_ERROR };
  redirect(`${appBase(row.org_slug, row.app_slug)}/welcome?tour=1`);
}
