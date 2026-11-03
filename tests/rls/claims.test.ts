// create_org_from_claim (0023): finishing a company's setup without the invite link, from the caller's own claim. It
// applies the same checks as create_org_from_invite (both now run through one core), and only ever uses the claim made
// for the signed-in user's own address.
import { afterAll, beforeAll, expect, it } from "vitest";
import { admin, args, claimArgs, cleanup, makeClaim, makeCompanyInvite, makeUser, rpc, type Tenant } from "./harness";

let claimed: Tenant, noClaim: Tenant, revoked: Tenant, used: Tenant, expired: Tenant, wrongEmail: Tenant, linkUser: Tenant;
const slug = (label: string) => `rls-claim-${label}-${Math.random().toString(16).slice(2, 8)}`;

beforeAll(async () => {
  [claimed, noClaim, revoked, used, expired, wrongEmail, linkUser] = await Promise.all(
    ["claimed", "noclaim", "revoked", "used", "expired", "wrongemail", "link"].map((l) => makeUser(l)),
  );
}, 60_000);
afterAll(cleanup, 60_000);

it("works for the claimed address: the caller owns the new company, the invite is used up and the claim is gone", async () => {
  const token = await makeCompanyInvite({ email: claimed.email });
  const inviteId = await makeClaim(claimed, token);
  const s = slug("ok");
  expect(await rpc(claimed, "create_org_from_claim", claimArgs(s))).toEqual([{ org_slug: s, app_slug: "app" }]);
  const { data: org } = await admin().from("organizations").select("id, org_members(user_id, role), projects(slug, kind)").eq("slug", s).single();
  expect(org?.org_members).toEqual([{ user_id: claimed.userId, role: "owner" }]);
  expect(org?.projects).toEqual([{ slug: "app", kind: "customer" }]);
  const { data: inv } = await admin().from("company_invites").select("consumed_by, org_id").eq("id", inviteId).single();
  expect(inv).toEqual({ consumed_by: claimed.userId, org_id: org!.id });
  expect((await admin().from("invite_claims").select("email").eq("email", claimed.email)).data).toEqual([]);
  // The claim is spent: a second company can't come from it, and the link itself is used up too.
  await expect(rpc(claimed, "create_org_from_claim", claimArgs(slug("again")))).rejects.toThrow("claim_not_found");
  await expect(rpc(claimed, "create_org_from_invite", args(token, slug("link")))).rejects.toThrow("invite_used");
});

it("refuses without a claim, and with only an expired one", async () => {
  await expect(rpc(noClaim, "create_org_from_claim", claimArgs(slug("none")))).rejects.toThrow("claim_not_found");
  await makeClaim(expired, await makeCompanyInvite({}), { expiresInMs: -60_000 });
  await expect(rpc(expired, "create_org_from_claim", claimArgs(slug("expired")))).rejects.toThrow("claim_not_found");
});

it("refuses once the invite is revoked or used, as the link would", async () => {
  const rToken = await makeCompanyInvite({});
  const rId = await makeClaim(revoked, rToken);
  expect((await admin().from("company_invites").update({ revoked_at: new Date().toISOString() }).eq("id", rId)).error).toBeNull();
  await expect(rpc(revoked, "create_org_from_claim", claimArgs(slug("revoked")))).rejects.toThrow("invite_revoked");

  // Used through the link by someone else first (an open invite), then the claim is tried.
  const uToken = await makeCompanyInvite({});
  await makeClaim(used, uToken);
  await rpc(linkUser, "create_org_from_invite", args(uToken, slug("first")));
  await expect(rpc(used, "create_org_from_claim", claimArgs(slug("used")))).rejects.toThrow("invite_used");
});

it("keeps the invite's email lock: a claim on an invite for another address doesn't work", async () => {
  await makeClaim(wrongEmail, await makeCompanyInvite({ email: claimed.email }));
  await expect(rpc(wrongEmail, "create_org_from_claim", claimArgs(slug("wrong")))).rejects.toThrow("invite_email");
});

it("signed out, and through the core directly, it can't be called", async () => {
  const anon = (await import("@supabase/supabase-js")).createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  expect((await anon.rpc("create_org_from_claim", claimArgs(slug("anon")))).error).not.toBeNull();
  const inviteId = await makeClaim(noClaim, await makeCompanyInvite({}));
  const direct = await noClaim.db.rpc("create_org_for_invite", { p_invite: inviteId, ...claimArgs(slug("direct")) });
  expect(direct.error?.message).toMatch(/permission denied|Could not find the function/);
});
