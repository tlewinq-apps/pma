// npm run create-user -- someone@example.com [--owner] — makes sure an account exists for the address (a confirmed
// one with no password, through the service role, when it doesn't yet). Sign in with GitHub first: your account then
// already exists, under your GitHub email, and this finds it. With --owner the account also becomes an owner of the demo
// company (made when missing) and a platform admin, which is all a fresh setup needs before `npm run seed:snapshot`.
// Prints no secrets.
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "../src/lib/db/server";
import { ensureDemoOrg } from "./lib/demo-app";
import { assertNotProd } from "./lib/guard";

/** The id of the account with this (lower-case) email, paging through the admin list. */
async function findUserId(db: SupabaseClient, email: string): Promise<string> {
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`list users: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 1000) throw new Error(`${email} has an account but it could not be found`);
  }
}

async function main() {
  assertNotProd("create-user");
  const args = process.argv.slice(2);
  const owner = args.includes("--owner");
  const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("Usage: npm run create-user -- someone@example.com [--owner]");
  const db = serviceDb();
  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
  let userId: string;
  if (error?.code === "email_exists") {
    console.log(`${email} already has an account.`);
    if (!owner) return;
    userId = await findUserId(db, email);
  } else {
    if (error || !data.user) throw new Error(error?.message ?? "No user came back");
    userId = data.user.id;
    console.log(`Created ${email} (${userId}).`);
  }
  if (!owner) { console.log("They are in no company and no admin list yet; see docs/self-hosting.md, or re-run with --owner."); return; }

  const orgId = await ensureDemoOrg(db);
  const member = await db.from("org_members").upsert({ org_id: orgId, user_id: userId, role: "owner" }, { onConflict: "org_id,user_id" });
  if (member.error) throw new Error(`org member: ${member.error.message}`);
  const admin = await db.from("platform_admins").upsert({ user_id: userId }, { onConflict: "user_id" });
  if (admin.error) throw new Error(`platform admin: ${admin.error.message}`);
  console.log(`${email} owns the demo company and is a platform admin.`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
