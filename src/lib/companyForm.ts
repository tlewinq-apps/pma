// The create-company form's fields (a company and its first app, each with a slug), checked the same way for every way
// in: the invite link (/invite/[token]), the claim (/invite/continue) and open sign-up (/no-company). Pure; the RPCs
// check everything again.
import { SLUG_MESSAGES, slugProblem } from "@/lib/links";

export type CreateField = "orgName" | "orgSlug" | "appName" | "appSlug";
export type CreateResult = { error: string; field?: CreateField } | null;
export type CompanyFields = { orgName: string; orgSlug: string; appName: string; appSlug: string };

const NAME_MAX = 80;

const text = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
};

/** The form's names and slugs, tidied, or the first problem with the field it belongs to. */
export function parseCompanyForm(form: FormData): { ok: true; value: CompanyFields } | { ok: false; error: string; field: CreateField } {
  const orgName = text(form, "orgName"), appName = text(form, "appName");
  const orgSlug = text(form, "orgSlug").toLowerCase(), appSlug = text(form, "appSlug").toLowerCase();
  if (!orgName || orgName.length > NAME_MAX) return { ok: false, error: `Give your company a name (up to ${NAME_MAX} characters).`, field: "orgName" };
  if (!appName || appName.length > NAME_MAX) return { ok: false, error: `Give your app a name (up to ${NAME_MAX} characters).`, field: "appName" };
  const orgSlugProblem = slugProblem(orgSlug);
  if (orgSlugProblem) return { ok: false, error: SLUG_MESSAGES[orgSlugProblem], field: "orgSlug" };
  const appSlugProblem = slugProblem(appSlug);
  if (appSlugProblem) return { ok: false, error: SLUG_MESSAGES[appSlugProblem], field: "appSlug" };
  return { ok: true, value: { orgName, orgSlug, appName, appSlug } };
}

/** The RPC's parameters for these fields (create_org_from_invite adds p_token). */
export const companyRpcArgs = (v: CompanyFields) => ({ p_org_name: v.orgName, p_org_slug: v.orgSlug, p_app_name: v.appName, p_app_slug: v.appSlug });
