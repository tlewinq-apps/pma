// src/lib/db/app.ts
// Finds the app a request is about, from the URL (/[org]/[app]) or from an id, as the signed-in user. Every lookup runs
// through RLS, so a user only ever finds an app that belongs to a company they are in. The company slug in a URL is a
// claim, not a credential: if the caller is not a member, the answer is the same as for a slug that does not exist.
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appBase } from "@/lib/links";
import type { Project } from "./project";
import { userDb } from "./server";

export type Role = "owner" | "admin" | "member";
export type Org = { id: string; name: string; slug: string };
export type AppCtx = { org: Org; project: Project; role: Role; userId: string; email: string; base: string };

/** The cookie that remembers which app the user last opened. Its value is "<org>/<app>". */
export const LAST_APP_COOKIE = "pma_last_app";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A project row with its company and the caller's own membership embedded. org_members is readable by everyone in the
// company, so the user_id filter is what narrows it to the caller (and `!inner` drops the project if there is no row).
const APP_SELECT = "*, organizations!inner(id,name,slug,org_members!inner(role))";

/** The embedded company with the caller's membership row. Filtered to the caller, so it holds one row (none if they left). */
type OrgEmbed = Org & { org_members: { role: Role }[] };

const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);

/** The company without the embedded membership, and the caller's role in it (null if there is no membership row). */
function splitOrg({ id, name, slug, org_members }: OrgEmbed): { org: Org; role: Role | null } {
  return { org: { id, name, slug }, role: org_members[0]?.role ?? null };
}

/** Turns a project row (with the embeds above) into the context minus the user: the company, the bare project, the role and the base. */
function toCtx(row: Project & { organizations: OrgEmbed }): Omit<AppCtx, "userId" | "email"> | null {
  const { organizations, ...project } = row;
  const { org, role } = splitOrg(organizations);
  return role ? { org, project, role, base: appBase(org.slug, project.slug) } : null;
}

/**
 * The app for a known user, by company and app slug or by id. null when it does not exist, is not visible to the user
 * (not in the company), or belongs to a company that has been deleted. A failing query throws: that is an outage, not a 404.
 */
async function findApp(
  db: SupabaseClient,
  userId: string,
  match: { orgSlug: string; appSlug: string } | { appId: string },
): Promise<Omit<AppCtx, "userId" | "email"> | null> {
  let q = db
    .from("projects")
    .select(APP_SELECT)
    .is("organizations.deleted_at", null)
    .eq("organizations.org_members.user_id", userId);
  // Slugs are citext columns, so these comparisons ignore case; the base is built from the stored slugs.
  q = "appId" in match ? q.eq("id", match.appId) : q.eq("slug", match.appSlug).eq("organizations.slug", match.orgSlug);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`app lookup failed: ${error.message}`);
  return data ? toCtx(data as unknown as Parameters<typeof toCtx>[0]) : null;
}

/**
 * The lookup requireApp does, for any Supabase client (the RLS test passes each tenant's own): one RLS-scoped select of
 * the project, its company and the caller's role. null for a non-member, an unknown slug or a deleted company; it
 * never throws for those. Not wrapped in cache: its argument is a client, and requireApp is what pages call.
 */
export async function resolveApp(db: SupabaseClient, orgSlug: string, appSlug: string): Promise<Omit<AppCtx, "userId" | "email"> | null> {
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  return findApp(db, user.id, { orgSlug, appSlug });
}

// One database client per request, so the lookups below share a session instead of each opening their own.
const requestDb = cache(userDb);

/** The signed-in user, or null. For API routes, which answer 401 themselves instead of redirecting. */
const currentUser = cache(async (): Promise<{ userId: string; email: string } | null> => {
  const { data: { user } } = await (await requestDb()).auth.getUser();
  return user ? { userId: user.id, email: user.email ?? "" } : null;
});

export const requireUser = cache(async (): Promise<{ userId: string; email: string }> => {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  return user;
});

/** For pages and layouts under /[org]/[app]: signed out goes to sign-in; not a member (or no such app) is a 404. */
export const requireApp = cache(async (orgSlug: string, appSlug: string): Promise<AppCtx> => {
  const user = await requireUser();
  const found = await findApp(await requestDb(), user.userId, { orgSlug, appSlug });
  if (!found) notFound();
  return { ...found, ...user };
});

/** For API routes: the app with this id if the caller is in its company, otherwise null (also null when signed out). */
export const appById = cache(async (appId: string): Promise<AppCtx | null> => {
  if (!UUID.test(appId)) return null;
  const user = await currentUser();
  if (!user) return null;
  const found = await findApp(await requestDb(), user.userId, { appId });
  return found && { ...found, ...user };
});

/** The app an issue belongs to. The issue is read under RLS first, so an issue in someone else's company is null. */
export const appForIssue = cache(async (issueId: string): Promise<AppCtx | null> => {
  if (!UUID.test(issueId)) return null;
  const { data, error } = await (await requestDb()).from("issues").select("project_id").eq("id", issueId).maybeSingle();
  if (error) throw new Error(`issue lookup failed: ${error.message}`);
  return data ? appById(data.project_id as string) : null;
});

/** The app a draft belongs to, through its issue. A draft in someone else's company is null (the draft is read under RLS first). */
export const appForDraft = cache(async (draftId: string): Promise<AppCtx | null> => {
  if (!UUID.test(draftId)) return null;
  const { data, error } = await (await requestDb()).from("drafts").select("issue_id").eq("id", draftId).maybeSingle();
  if (error) throw new Error(`draft lookup failed: ${error.message}`);
  return data ? appForIssue(data.issue_id as string) : null;
});

/** The app a source belongs to; a source in someone else's company is null. */
export const appForSource = cache(async (sourceId: string): Promise<AppCtx | null> => {
  if (!UUID.test(sourceId)) return null;
  const { data, error } = await (await requestDb()).from("sources").select("project_id").eq("id", sourceId).maybeSingle();
  if (error) throw new Error(`source lookup failed: ${error.message}`);
  return data ? appById(data.project_id as string) : null;
});

/** Every app the signed-in user can open, with the company and their role there, ordered by company slug then app slug. */
export const myApps = cache(async (): Promise<{ org: Org; app: { id: string; slug: string; name: string }; role: Role }[]> => {
  const user = await currentUser();
  if (!user) return [];
  const { data, error } = await (await requestDb())
    .from("projects")
    .select("id, slug, name, organizations!inner(id,name,slug,org_members!inner(role))")
    .is("organizations.deleted_at", null)
    .eq("organizations.org_members.user_id", user.userId);
  if (error) throw new Error(`app list failed: ${error.message}`);
  const rows = (data ?? []) as unknown as { id: string; slug: string; name: string; organizations: OrgEmbed }[];
  return rows
    .flatMap((r) => {
      const { org, role } = splitOrg(r.organizations);
      return role ? [{ org, app: { id: r.id, slug: r.slug, name: r.name }, role }] : [];
    })
    .sort((x, y) => cmp(x.org.slug, y.org.slug) || cmp(x.app.slug, y.app.slug));
});

export function hasRole(ctx: AppCtx, roles: Role[]): boolean {
  return roles.includes(ctx.role);
}

/** Where "open PMA" should land: the app the user last opened if they can still open it, else their first app, else null. */
export const lastAppHref = cache(async (): Promise<string | null> => {
  const apps = await myApps();
  const last = (await cookies()).get(LAST_APP_COOKIE)?.value;
  const match = last && apps.find((a) => `${a.org.slug}/${a.app.slug}` === last);
  const pick = match || apps[0];
  return pick ? appBase(pick.org.slug, pick.app.slug) : null;
});
