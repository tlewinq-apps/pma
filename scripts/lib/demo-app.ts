// The demo app the seed scripts fill: Celeste, in the demo company (organizations.slug "demo", projects.slug
// "celeste", kind "demo"). Both are found first and made only when missing, so the seeds stay idempotent.
import type { SupabaseClient } from "@supabase/supabase-js";

export const DEMO_ORG = { name: "PMA Demo", slug: "demo" };
export const DEMO_APP = { name: "Celeste", slug: "celeste" };

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

/** The id of the `demo` company, created (name "PMA Demo") when it does not exist yet. */
export async function ensureDemoOrg(db: SupabaseClient): Promise<string> {
  const find = async () => must(await db.from("organizations").select("id, deleted_at").eq("slug", DEMO_ORG.slug).maybeSingle(), "find organization") as { id: string; deleted_at: string | null } | null;
  let org = await find();
  if (!org) {
    const ins = await db.from("organizations").insert(DEMO_ORG).select("id, deleted_at").single();
    // Two seeds started together can both miss the first lookup; the unique slug makes the loser read the winner's row.
    org = ins.error ? await find() : (ins.data as { id: string; deleted_at: string | null });
    if (!org) throw new Error(`create organization: ${ins.error?.message ?? "no row returned"}`);
  }
  if (org.deleted_at) throw new Error(`The ${DEMO_ORG.slug} company is deleted; restore it before seeding.`);
  return org.id;
}

/** The id of the Celeste demo app inside `orgId`, created when missing. `repo` only applies when the app is created. */
export async function ensureDemoApp(db: SupabaseClient, orgId: string, repo: string | null = null): Promise<string> {
  const find = async () => must(await db.from("projects").select("id").eq("org_id", orgId).eq("slug", DEMO_APP.slug).maybeSingle(), "find project") as { id: string } | null;
  const found = await find();
  if (found) return found.id;
  const ins = await db.from("projects").insert({ org_id: orgId, name: DEMO_APP.name, slug: DEMO_APP.slug, kind: "demo", repo_full_name: repo }).select("id").single();
  if (ins.error) {
    const again = await find();
    if (again) return again.id;
    throw new Error(`create project: ${ins.error.message}`);
  }
  return (ins.data as { id: string }).id;
}
