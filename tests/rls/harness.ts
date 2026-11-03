// Data-isolation test harness: real users on the hosted DEV Supabase project, never production.
// Run with `npm run test:rls` (loads .env.local). `npm test` excludes tests/rls so it stays database-free.
// Row-level security is the tenant boundary, so these tests sign in as ordinary users through the anon key and
// check what the policies let them see and change; the service role is used only to set up and tear down.
//
// Access is company-level (supabase/migrations/0018_orgs.sql): a user sees an app because they are in the company
// (organizations + org_members) that owns it. `makeApp` builds that whole chain.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { assertNotProd } from "../../scripts/lib/guard";

assertNotProd("test:rls");

export type Tenant = { userId: string; email: string; db: SupabaseClient };
export type Role = "owner" | "admin" | "member";
/** A company with one app (a `projects` row) and one issue in it. */
export type App = { orgId: string; orgSlug: string; appId: string; appSlug: string; issueId: string };

// Everything this run created, so cleanup() can remove exactly that and nothing else.
const created = {
  users: [] as string[],
  orgs: [] as string[],
  projects: [] as string[],
  issues: [] as string[],
  orgMembers: [] as { org_id: string; user_id: string }[],
  companyInvites: [] as string[],
  claims: [] as string[],
  platformAdmins: [] as string[],
};

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`test:rls needs ${name}; run it through "npm run test:rls" so .env.local is loaded.`);
  return v;
}

function client(key: string): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

const rand = (bytes = 4) => randomBytes(bytes).toString("hex");

let adminClient: SupabaseClient | undefined;
/** The service role: bypasses RLS. Only for setup, teardown and reading back what a tenant tried to change. */
export function admin(): SupabaseClient {
  return (adminClient ??= client(env("SUPABASE_SERVICE_ROLE_KEY")));
}

/** Creates a confirmed user and returns an anon-key client signed in as them. */
export async function makeUser(label: string): Promise<Tenant> {
  const email = `rls-${label}-${rand()}@pma.test`;
  const password = rand(16);
  const made = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error || !made.data.user) throw new Error(`createUser ${label}: ${made.error?.message ?? "no user returned"}`);
  const userId = made.data.user.id;
  created.users.push(userId); // tracked before sign-in so a failed sign-in still gets cleaned up
  const db = client(env("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
  const signed = await db.auth.signInWithPassword({ email, password });
  if (signed.error) throw new Error(`signIn ${label}: ${signed.error.message}`);
  return { userId, email, db };
}

/** Adds the tenant to a company with the given role. */
export async function addOrgMember(orgId: string, t: Tenant, role: Role): Promise<void> {
  const r = await admin().from("org_members").insert({ org_id: orgId, user_id: t.userId, role });
  if (r.error) throw new Error(`insert org_member: ${r.error.message}`);
  created.orgMembers.push({ org_id: orgId, user_id: t.userId });
}

/** Creates a company with the tenant in it (owner by default), one app in that company, and one issue in the app. */
export async function makeApp(t: Tenant, role: Role = "owner"): Promise<App> {
  const a = admin();
  const orgSlug = `rls-${rand()}`;
  const org = await a.from("organizations").insert({ name: orgSlug, slug: orgSlug }).select("id").single();
  if (org.error) throw new Error(`insert organization: ${org.error.message}`);
  const orgId = org.data.id as string;
  created.orgs.push(orgId);

  await addOrgMember(orgId, t, role);

  const appSlug = `app-${rand()}`;
  const project = await a
    .from("projects")
    .insert({ name: `rls-${appSlug}`, org_id: orgId, slug: appSlug, kind: "customer" })
    .select("id")
    .single();
  if (project.error) throw new Error(`insert project: ${project.error.message}`);
  const appId = project.data.id as string;
  created.projects.push(appId);

  const issue = await a
    .from("issues")
    .insert({ project_id: appId, title: "rls issue", problem_statement: "rls problem", type: "bug" })
    .select("id")
    .single();
  if (issue.error) throw new Error(`insert issue: ${issue.error.message}`);
  const issueId = issue.data.id as string;
  created.issues.push(issueId);
  return { orgId, orgSlug, appId, appSlug, issueId };
}

/** Makes the tenant a platform admin (the site owner, in production). It gives no company membership. */
export async function makePlatformAdmin(t: Tenant): Promise<void> {
  const r = await admin().from("platform_admins").insert({ user_id: t.userId });
  if (r.error) throw new Error(`insert platform_admin: ${r.error.message}`);
  created.platformAdmins.push(t.userId);
}

/** Inserts a company invite (valid for a day, optionally locked to an email) and returns the raw token. */
export async function makeCompanyInvite({ email }: { email?: string } = {}): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const token_hash = createHash("sha256").update(token).digest("hex");
  const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const r = await admin().from("company_invites").insert({ token_hash, email: email ?? null, expires_at }).select("id").single();
  if (r.error) throw new Error(`insert company_invite: ${r.error.message}`);
  created.companyInvites.push(r.data.id as string);
  return token;
}

/** Saves a claim on the invite behind `token` for the tenant's address, as the /invite page does before it sends the
 *  sign-in email. `expiresInMs` defaults to the page's hour; a negative value makes an expired claim. Returns the invite id. */
export async function makeClaim(t: Tenant, token: string, { expiresInMs = 60 * 60 * 1000 }: { expiresInMs?: number } = {}): Promise<string> {
  const token_hash = createHash("sha256").update(token).digest("hex");
  const inv = await admin().from("company_invites").select("id").eq("token_hash", token_hash).single();
  if (inv.error) throw new Error(`find company_invite: ${inv.error.message}`);
  const r = await admin().from("invite_claims").upsert({ email: t.email, company_invite_id: inv.data.id, expires_at: new Date(Date.now() + expiresInMs).toISOString() }, { onConflict: "email" });
  if (r.error) throw new Error(`insert invite_claim: ${r.error.message}`);
  if (!created.claims.includes(t.email)) created.claims.push(t.email);
  return inv.data.id as string;
}

/** create_org_from_claim parameters, using the slug as the company name and a fixed app. */
export function claimArgs(slug: string) {
  return { p_org_name: slug, p_org_slug: slug, p_app_name: "App", p_app_slug: "app" };
}

/** create_org_from_invite parameters, using the slug as the company name and a fixed app. */
export function args(token: string, slug: string) {
  return { p_token: token, p_org_name: slug, p_org_slug: slug, p_app_name: "App", p_app_slug: "app" };
}

/** Calls an RPC as the tenant and returns its data; a database error is thrown with its message (e.g. "last_owner"). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rpc<T = any>(t: Tenant, name: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await t.db.rpc(name, params);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Deletes every user and row this run created. Safe to call twice; throws if anything could not be removed. */
export async function cleanup(): Promise<void> {
  const a = admin();
  const failures: string[] = [];
  const note = (what: string, error: { message: string } | null) => { if (error) failures.push(`${what}: ${error.message}`); };

  // Companies the run's users made through create_org_from_invite. Deleting a company cascades to its apps, their
  // issues and its members.
  if (created.users.length) {
    const made = await a.from("organizations").select("id").in("created_by", created.users);
    note("find organizations", made.error);
    for (const o of made.data ?? []) if (!created.orgs.includes(o.id)) created.orgs.push(o.id);
  }

  if (created.issues.length) note("issues", (await a.from("issues").delete().in("id", created.issues)).error);
  if (created.projects.length) note("projects", (await a.from("projects").delete().in("id", created.projects)).error);
  for (const m of created.orgMembers) note("org_members", (await a.from("org_members").delete().eq("org_id", m.org_id).eq("user_id", m.user_id)).error);
  if (created.orgs.length) note("organizations", (await a.from("organizations").delete().in("id", created.orgs)).error);
  if (created.companyInvites.length) note("company_invites", (await a.from("company_invites").delete().in("id", created.companyInvites)).error);
  if (created.claims.length) note("invite_claims", (await a.from("invite_claims").delete().in("email", created.claims)).error);
  if (created.platformAdmins.length) note("platform_admins", (await a.from("platform_admins").delete().in("user_id", created.platformAdmins)).error);
  for (const id of created.users) {
    const r = await a.auth.admin.deleteUser(id);
    // Already gone is fine (cleanup may run twice); anything else is a real failure.
    if (r.error && !/not found/i.test(r.error.message)) note(`user ${id}`, r.error);
  }

  for (const list of Object.values(created)) list.length = 0;
  if (failures.length) throw new Error(`test:rls cleanup left rows behind: ${failures.join("; ")}`);
}
