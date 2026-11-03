// The members page's database side (supabase/migrations/0020_member_invite_admin.sql): withdrawing a pending member
// invite, replacing its link (only token hashes are stored, so a lost link can't be shown again, only replaced), and
// listing a company's members with their emails.
import { afterAll, beforeAll, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { addOrgMember, admin, cleanup, makeApp, makePlatformAdmin, makeUser, rpc, type App, type Tenant } from "./harness";

// Company A: owner, admin `adminUser`, plain `member`. Company B: owner `outsider`. `platform` is a platform admin in no
// company. e1, e2, e3 and e4 are invitees in no company.
let owner: Tenant, adminUser: Tenant, member: Tenant, outsider: Tenant, platform: Tenant;
let e1: Tenant, e2: Tenant, e3: Tenant, e4: Tenant;
let A: App;

const NOBODY = "00000000-0000-4000-8000-000000000000";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The id of the pending invite for this address in company A (read with the service role). */
async function inviteId(email: string): Promise<string> {
  const { data, error } = await admin().from("member_invites").select("id")
    .eq("org_id", A.orgId).eq("email", email).is("accepted_at", null).is("revoked_at", null).single();
  if (error) throw new Error(`find invite: ${error.message}`);
  return data.id as string;
}

beforeAll(async () => {
  [owner, adminUser, member, outsider, platform, e1, e2, e3, e4] = await Promise.all(
    ["owner", "admin", "member", "outsider", "platform", "e1", "e2", "e3", "e4"].map((label) => makeUser(label)),
  );
  [A] = await Promise.all([makeApp(owner), makeApp(outsider)]);
  await addOrgMember(A.orgId, adminUser, "admin");
  await addOrgMember(A.orgId, member, "member");
  await makePlatformAdmin(platform);
}, 60_000);
afterAll(cleanup, 60_000);

it("only the company's owners and admins can withdraw or replace its invites", async () => {
  await rpc(owner, "invite_member", { p_org: A.orgId, p_email: e1.email, p_role: "member" });
  const id = await inviteId(e1.email);
  for (const t of [member, outsider, platform, e1]) {
    await expect(rpc(t, "revoke_member_invite", { p_invite: id })).rejects.toThrow("forbidden");
    await expect(rpc(t, "rotate_member_invite", { p_invite: id })).rejects.toThrow("forbidden");
  }
  // An id that doesn't exist reads the same as one you may not touch.
  await expect(rpc(owner, "revoke_member_invite", { p_invite: NOBODY })).rejects.toThrow("forbidden");
  await expect(rpc(owner, "rotate_member_invite", { p_invite: NOBODY })).rejects.toThrow("forbidden");
  // Nothing changed: the invite is still pending.
  expect(await inviteId(e1.email)).toBe(id);
});

it("a new link replaces the old one: the old token stops working and the new one joins", async () => {
  const old = await rpc<string>(adminUser, "invite_member", { p_org: A.orgId, p_email: e2.email, p_role: "member" });
  const id = await inviteId(e2.email);
  await admin().from("member_invites").update({ expires_at: new Date(Date.now() + 60_000).toISOString() }).eq("id", id);

  const fresh = await rpc<string>(adminUser, "rotate_member_invite", { p_invite: id });
  expect(fresh).toMatch(TOKEN);
  expect(fresh).not.toBe(old);
  // Seven days again from now, so a nearly expired (or expired) invite can be sent again.
  const { data: row } = await admin().from("member_invites").select("expires_at").eq("id", id).single();
  expect(Date.parse(row!.expires_at) - Date.now()).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);

  await expect(rpc(e2, "accept_member_invite", { p_token: old })).rejects.toThrow("invite_not_found");
  expect(await rpc(e2, "accept_member_invite", { p_token: fresh })).toEqual([{ org_slug: A.orgSlug }]);
  // Accepted: it is no longer pending, so it can be neither replaced nor withdrawn.
  await expect(rpc(adminUser, "rotate_member_invite", { p_invite: id })).rejects.toThrow("invite_used");
  await expect(rpc(adminUser, "revoke_member_invite", { p_invite: id })).rejects.toThrow("invite_used");
});

it("a withdrawn invite can't be accepted, replaced or withdrawn again", async () => {
  const token = await rpc<string>(owner, "invite_member", { p_org: A.orgId, p_email: e3.email, p_role: "admin" });
  const id = await inviteId(e3.email);
  await rpc(owner, "revoke_member_invite", { p_invite: id });
  await expect(rpc(e3, "accept_member_invite", { p_token: token })).rejects.toThrow("invite_revoked");
  await expect(rpc(owner, "rotate_member_invite", { p_invite: id })).rejects.toThrow("invite_revoked");
  await expect(rpc(owner, "revoke_member_invite", { p_invite: id })).rejects.toThrow("invite_revoked");
  expect((await e3.db.from("issues").select("id").eq("project_id", A.appId)).data).toEqual([]);
});

it("an admin can withdraw an invite too", async () => {
  await rpc(owner, "invite_member", { p_org: A.orgId, p_email: e4.email, p_role: "member" });
  const id = await inviteId(e4.email);
  await rpc(adminUser, "revoke_member_invite", { p_invite: id });
  const { data } = await admin().from("member_invites").select("revoked_at").eq("id", id).single();
  expect(data!.revoked_at).not.toBeNull();
});

it("members list their company's members with emails and roles; nobody else gets a row", async () => {
  const rows = await rpc<{ user_id: string; email: string; role: string }[]>(member, "org_member_list", { p_org: A.orgId });
  const byUser = new Map(rows.map((r) => [r.user_id, r]));
  expect(byUser.get(owner.userId)).toMatchObject({ email: owner.email, role: "owner" });
  expect(byUser.get(adminUser.userId)).toMatchObject({ email: adminUser.email, role: "admin" });
  expect(byUser.get(member.userId)).toMatchObject({ email: member.email, role: "member" });
  expect(Object.keys(rows[0]).sort()).toEqual(["created_at", "email", "role", "user_id"]);
  // Owners first, then admins, then members.
  expect(rows[0].role).toBe("owner");
  for (const t of [outsider, platform, e1]) expect(await rpc(t, "org_member_list", { p_org: A.orgId })).toEqual([]);
});

it("signed-out callers can't run any of them", async () => {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const anon: Tenant = { userId: "", email: "", db };
  for (const [name, params] of [
    ["revoke_member_invite", { p_invite: NOBODY }], ["rotate_member_invite", { p_invite: NOBODY }], ["org_member_list", { p_org: A.orgId }],
  ] as const) {
    await expect(rpc(anon, name, params)).rejects.toThrow(/permission denied/);
  }
});
