"use server";
// Finishing a company's setup from the signed-in person's own invite claim (/invite/continue). A public POST endpoint
// like every server action, so it acts only as the session's user: create_org_from_claim finds the claim by their
// auth email and applies every check the invite link would.
import { redirect } from "next/navigation";
import { userDb } from "@/lib/db/server";
import { CLAIM_MISSING, GENERIC_INVITE_ERROR, inviteError } from "@/lib/invites";
import { appBase } from "@/lib/links";
import { companyRpcArgs, parseCompanyForm, type CreateResult } from "@/lib/companyForm";

export async function createCompanyFromClaim(form: FormData): Promise<CreateResult> {
  if (!(form instanceof FormData)) return { error: GENERIC_INVITE_ERROR };
  const db = await userDb();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/sign-in?next=%2Finvite%2Fcontinue");

  const fields = parseCompanyForm(form);
  if (!fields.ok) return { error: fields.error, field: fields.field };

  const { data, error } = await db.rpc("create_org_from_claim", companyRpcArgs(fields.value));
  if (error?.message === "claim_not_found") return { error: CLAIM_MISSING };
  // A new company has no apps, so a taken slug can only be the company's.
  if (error) return { error: inviteError(error), ...(error.message === "slug_taken" ? { field: "orgSlug" as const } : {}) };
  const row = (Array.isArray(data) ? data[0] : data) as { org_slug: string; app_slug: string } | undefined;
  if (!row) return { error: GENERIC_INVITE_ERROR };
  redirect(`${appBase(row.org_slug, row.app_slug)}/welcome?tour=1`);
}
