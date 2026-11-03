// Playwright globalSetup: the e2e people, companies and sign-in states, on the DEV Supabase project only.
//
// Each run makes sure these exist (looked up first, so a rerun reuses them) through the service role:
//   e2e-owner@pma.test     owner of demo
//   e2e-member@pma.test    member of demo
//   e2e-two-orgs@pma.test  member of demo and of e2e-other
//   e2e-other-admin@pma.test  admin of e2e-other only (not in demo)
//   e2e-no-org@pma.test    in no company
//   e2e-platform@pma.test  platform admin, in no company
// plus a second company, e2e-other, with one app (`app`, kind customer) holding one issue.
//
// Each person is signed in by building the @supabase/ssr session cookies directly (password sign-in into an in-memory
// cookie jar), not through /auth/callback, so sign-in does not depend on the callback's allow-list. The cookies are
// saved as Playwright storage states at e2e/.auth/<name>.json, and the ids tests need go to e2e/.fixtures.json.
// Both are git-ignored: the states hold live sessions.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { FullConfig } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { isProdUrl } from "../scripts/lib/guard";

type Role = "owner" | "admin" | "member";
type Person = { name: string; email: string; demo?: Role; other?: Role; platform?: boolean };

const PEOPLE: Person[] = [
  { name: "owner", email: "e2e-owner@pma.test", demo: "owner" },
  { name: "member", email: "e2e-member@pma.test", demo: "member" },
  { name: "two-orgs", email: "e2e-two-orgs@pma.test", demo: "member", other: "member" },
  { name: "other-admin", email: "e2e-other-admin@pma.test", other: "admin" },
  { name: "no-org", email: "e2e-no-org@pma.test" },
  { name: "platform", email: "e2e-platform@pma.test", platform: true },
];
const DEMO = { org: "demo", app: "celeste" };
const OTHER = { org: "e2e-other", app: "app" };


function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`e2e setup needs ${name} (from .env.local).`);
  return v;
}

/** Finds an auth user by email; dev holds few users, so paging through them is fine. */
async function findUser(admin: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
}

/** The user with this email, created if missing, with a fresh random password for this run. */
async function ensureUser(admin: SupabaseClient, email: string, password: string): Promise<string> {
  const id = await findUser(admin, email);
  if (id) {
    const { error } = await admin.auth.admin.updateUserById(id, { password, email_confirm: true });
    if (error) throw new Error(`updateUser ${email}: ${error.message}`);
    return id;
  }
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message ?? "no user returned"}`);
  return data.user.id;
}

/** Runs a query and throws on error. Rows come back loosely typed (no generated database types here). */
async function one(label: string, q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Record<string, unknown> | null> {
  const { data, error } = await q;
  if (error) throw new Error(`${label}: ${error.message}`);
  return (data as Record<string, unknown> | null) ?? null;
}

/** The id of the first row `find` returns, or of the row `insert` makes when there is none. */
async function findOrInsert(label: string, find: PromiseLike<{ data: unknown; error: { message: string } | null }>, insert: () => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<string> {
  const row = (await one(`find ${label}`, find)) ?? (await one(`insert ${label}`, insert()));
  if (!row) throw new Error(`insert ${label}: no row returned`);
  return row.id as string;
}

/** Finds (or makes) the second company, its app and one issue in it. */
async function ensureOtherCompany(admin: SupabaseClient): Promise<{ orgId: string; appId: string; issueId: string }> {
  const orgId = await findOrInsert("e2e-other", admin.from("organizations").select("id").eq("slug", OTHER.org).maybeSingle(),
    () => admin.from("organizations").insert({ name: "E2E Other", slug: OTHER.org }).select("id").single());
  const appId = await findOrInsert("e2e-other app", admin.from("projects").select("id").eq("org_id", orgId).eq("slug", OTHER.app).maybeSingle(),
    () => admin.from("projects").insert({ name: "E2E Other app", org_id: orgId, slug: OTHER.app, kind: "customer" }).select("id").single());
  const issueId = await findOrInsert("e2e-other issue", admin.from("issues").select("id").eq("project_id", appId).order("created_at").limit(1).maybeSingle(),
    () => admin.from("issues").insert({ project_id: appId, title: "E2E other company issue", problem_statement: "Belongs to e2e-other.", type: "bug" }).select("id").single());
  return { orgId, appId, issueId };
}

/** Makes the person's memberships exactly what PEOPLE says, in demo and e2e-other (other companies are left alone). */
async function setMemberships(admin: SupabaseClient, userId: string, wanted: { orgId: string; role?: Role }[]) {
  for (const { orgId, role } of wanted) {
    if (role) await one("upsert org_member", admin.from("org_members").upsert({ org_id: orgId, user_id: userId, role }, { onConflict: "org_id,user_id" }));
    else await one("delete org_member", admin.from("org_members").delete().eq("org_id", orgId).eq("user_id", userId));
  }
}

type Cookie = { name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: "Lax" | "Strict" | "None" };

/** Signs in with the password and returns the @supabase/ssr session cookies as they would be set on the app's domain. */
async function sessionCookies(email: string, password: string, domain: string): Promise<Cookie[]> {
  const jar = new Map<string, { value: string; maxAge?: number }>();
  const db = createServerClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    cookies: {
      getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
      setAll: (list) => list.forEach(({ name, value, options }) => (value ? jar.set(name, { value, maxAge: options?.maxAge }) : jar.delete(name))),
    },
  });
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  for (let i = 0; i < 20 && jar.size === 0; i++) await new Promise((r) => setTimeout(r, 50));
  if (jar.size === 0) throw new Error(`sign in ${email}: no session cookies were written`);
  const now = Math.floor(Date.now() / 1000);
  return [...jar].map(([name, c]) => ({
    name, value: c.value, domain, path: "/", expires: c.maxAge ? now + c.maxAge : -1, httpOnly: false, secure: false, sameSite: "Lax",
  }));
}

export default async function globalSetup(config: FullConfig) {
  const ROOT = config.configFile ? path.dirname(config.configFile) : process.cwd();
  const AUTH_DIR = path.join(ROOT, "e2e", ".auth");
  const FIXTURES = path.join(ROOT, "e2e", ".fixtures.json");
  if (existsSync(path.join(ROOT, ".env.local"))) process.loadEnvFile(path.join(ROOT, ".env.local"));
  // Unconditional, and before any write: this creates users, companies and sessions. Unlike the maintenance scripts there
  // is no PMA_ALLOW_PROD override; the e2e suite runs on dev, whatever E2E_URL points at.
  if (isProdUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error("e2e setup refuses to run against the production Supabase project (it creates users and companies). Point .env.local at the dev project.");
  const admin = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:3000";
  const domain = new URL(baseURL).hostname;

  const demoApp = await one("find the demo app", admin.from("projects").select("id, org_id, organizations!inner(slug)").eq("slug", DEMO.app).eq("organizations.slug", DEMO.org).maybeSingle());
  if (!demoApp) throw new Error("e2e setup needs the demo/celeste demo app on dev; run `npm run seed`.");
  const demoAppId = demoApp.id as string, demoOrgId = demoApp.org_id as string;
  const demoIssue = await one("find a demo issue", admin.from("issues").select("id").eq("project_id", demoAppId).order("created_at").limit(1).maybeSingle());
  if (!demoIssue) throw new Error("e2e setup needs seeded demo issues on dev; run `npm run seed`.");
  // A feedback source and a draft in the demo app, for the old /feedback/<id> and /mock/pr/<id> links. The seed may
  // hold no draft; the tests that need one skip when its id is absent.
  const demoSource = await one("find a demo source", admin.from("sources").select("id").eq("project_id", demoAppId).order("created_at").limit(1).maybeSingle());
  const demoDraft = await one("find a demo draft", admin.from("drafts").select("id, issues!inner(project_id)").eq("issues.project_id", demoAppId).order("created_at", { ascending: false }).limit(1).maybeSingle());
  const other = await ensureOtherCompany(admin);

  mkdirSync(AUTH_DIR, { recursive: true });
  for (const p of PEOPLE) {
    const password = randomBytes(18).toString("base64url");
    const userId = await ensureUser(admin, p.email, password);
    await setMemberships(admin, userId, [{ orgId: demoOrgId, role: p.demo }, { orgId: other.orgId, role: p.other }]);
    if (p.platform) await one("upsert platform_admin", admin.from("platform_admins").upsert({ user_id: userId }, { onConflict: "user_id" }));
    else await one("delete platform_admin", admin.from("platform_admins").delete().eq("user_id", userId));
    const cookies = await sessionCookies(p.email, password, domain);
    writeFileSync(path.join(AUTH_DIR, `${p.name}.json`), JSON.stringify({ cookies, origins: [] }, null, 2));
  }

  writeFileSync(FIXTURES, JSON.stringify({
    DEMO_APP_ID: demoAppId,
    DEMO_ISSUE_ID: demoIssue.id as string,
    ...(demoSource ? { DEMO_SOURCE_ID: demoSource.id as string } : {}),
    ...(demoDraft ? { DEMO_DRAFT_ID: demoDraft.id as string } : {}),
    OTHER_ORG: OTHER.org,
    OTHER_APP: OTHER.app,
    OTHER_ORG_APP_ID: other.appId,
    OTHER_ORG_ISSUE_ID: other.issueId,
  }, null, 2));
}
