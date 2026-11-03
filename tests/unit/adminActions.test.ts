// The server actions behind /admin and the members page are public POST endpoints. /admin's write company_invites
// through the service role (no RLS, no grants for signed-in users), so the platform-admin check is the only thing
// keeping company invites to platform admins; the members actions check the caller's membership before any RPC. These tests
// prove each action refuses first and never reaches the database when it should refuse.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  platformAdmin: false as boolean,
  membership: null as { role: string } | null,
  rpc: vi.fn(),
  serviceDb: vi.fn(),
}));

vi.mock("@/lib/db/server", () => {
  // org_members lookups: .select().eq().eq().maybeSingle() resolves to the membership the test set.
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: h.membership, error: null }) };
  return {
    userDb: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) }, rpc: h.rpc, from: () => query }),
    serviceDb: h.serviceDb,
  };
});
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); },
}));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

import { createCompanyInvite, revokeCompanyInvite } from "@/app/admin/actions";
import {
  changeRole, inviteTeammate, removeMember, revokeMemberInvite, rotateMemberInvite,
} from "@/app/(app)/[org]/settings/members/actions";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  h.user = { id: "33333333-3333-4333-8333-333333333333" };
  h.platformAdmin = false;
  h.membership = null;
  h.rpc.mockReset();
  h.rpc.mockImplementation(async (name: string) => (name === "is_platform_admin" ? { data: h.platformAdmin, error: null } : { data: "token", error: null }));
  h.serviceDb.mockReset();
  // A service client whose writes succeed, for the control cases that should get through.
  const write = { insert: async () => ({ error: null }), update: () => write, eq: () => write, is: () => write, select: async () => ({ data: [{ id: OTHER }], error: null }) };
  h.serviceDb.mockReturnValue({ from: () => write, auth: { admin: { inviteUserByEmail: async () => ({ error: { status: 400 } }) } } });
});

/** The RPCs an action called, other than the platform-admin check. */
const rpcsBesidesCheck = () => h.rpc.mock.calls.map(([name]) => name).filter((n) => n !== "is_platform_admin");

describe("/admin actions", () => {
  const actions = {
    createCompanyInvite: () => createCompanyInvite({ email: "", note: "x", days: 7 }),
    revokeCompanyInvite: () => revokeCompanyInvite(OTHER),
  };

  for (const [name, run] of Object.entries(actions)) {
    it(`${name} is a 404 for a signed-in user who is not a platform admin, and never touches company_invites`, async () => {
      await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(h.rpc).toHaveBeenCalledWith("is_platform_admin");
      expect(h.serviceDb).not.toHaveBeenCalled();
    });

    it(`${name} is a 404 when signed out, and never touches company_invites`, async () => {
      h.user = null;
      await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(h.serviceDb).not.toHaveBeenCalled();
    });

    it(`${name} goes through for a platform admin (the control: the mocks above can reach the service role)`, async () => {
      h.platformAdmin = true;
      await run();
      expect(h.serviceDb).toHaveBeenCalled();
    });
  }

  it("a failing platform-admin check throws instead of letting the action through", async () => {
    h.rpc.mockImplementation(async () => ({ data: null, error: { message: "boom" } }));
    await expect(createCompanyInvite({ days: 7 })).rejects.toThrow("platform admin check failed");
    expect(h.serviceDb).not.toHaveBeenCalled();
  });
});

describe("members page actions", () => {
  const actions = {
    inviteTeammate: () => inviteTeammate(ORG, "someone@pma.test", "member"),
    changeRole: () => changeRole(ORG, OTHER, "admin"),
    removeMember: () => removeMember(ORG, OTHER),
    revokeMemberInvite: () => revokeMemberInvite(ORG, OTHER),
    rotateMemberInvite: () => rotateMemberInvite(ORG, OTHER),
  };

  for (const [name, run] of Object.entries(actions)) {
    it(`${name} is a 404 for someone outside the company, before any RPC or service-role call`, async () => {
      await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(h.rpc).not.toHaveBeenCalled();
      expect(h.serviceDb).not.toHaveBeenCalled();
    });

    it(`${name} sends a signed-out caller to sign-in, before any RPC or service-role call`, async () => {
      h.user = null;
      await expect(run()).rejects.toThrow("NEXT_REDIRECT /sign-in");
      expect(h.rpc).not.toHaveBeenCalled();
      expect(h.serviceDb).not.toHaveBeenCalled();
    });

    it(`${name} goes through for an owner (the control: the mocks above can reach the RPC)`, async () => {
      h.membership = { role: "owner" };
      await run();
      expect(rpcsBesidesCheck().length).toBeGreaterThan(0);
    });
  }

  it("a plain member is refused every change with a sentence, before any RPC", async () => {
    h.membership = { role: "member" };
    expect(await actions.inviteTeammate()).toEqual({ error: "Only company owners and admins can change this." });
    expect(await actions.revokeMemberInvite()).toEqual({ error: "Only company owners and admins can change this." });
    expect(await actions.rotateMemberInvite()).toEqual({ error: "Only company owners and admins can change this." });
    expect(await actions.changeRole()).toEqual({ error: "Only company owners can change this." });
    expect(await actions.removeMember()).toEqual({ error: "Only company owners can change this." });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.serviceDb).not.toHaveBeenCalled();
  });

  it("an admin may invite but not change roles or remove anyone", async () => {
    h.membership = { role: "admin" };
    expect(await actions.changeRole()).toEqual({ error: "Only company owners can change this." });
    expect(await actions.removeMember()).toEqual({ error: "Only company owners can change this." });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(await actions.inviteTeammate()).toEqual({ link: expect.stringMatching(/\/join\//) });
    expect(rpcsBesidesCheck()).toEqual(["invite_member"]);
  });

  it("a made-up company id is a 404 without a lookup", async () => {
    await expect(changeRole("not-a-uuid", OTHER, "admin")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
