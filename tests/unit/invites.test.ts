import { describe, it, expect } from "vitest";
import { INVITE_MESSAGES, inviteError, hashToken, inviteProblem, isEmail } from "@/lib/invites";
import { SLUG_MESSAGES } from "@/lib/links";

describe("inviteError", () => {
  it("maps RPC errors to plain sentences", () => {
    expect(inviteError(new Error("invite_used"))).toBe("This invite link was already used. Ask for a new one.");
    expect(inviteError({ message: "slug_taken" })).toBe(SLUG_MESSAGES.slug_taken);
    expect(inviteError(new Error("boom"))).toBe("Something went wrong. Try the link again.");
  });

  it("has the exact copy for every invite code", () => {
    expect(INVITE_MESSAGES).toEqual({
      invite_used: "This invite link was already used. Ask for a new one.",
      invite_expired: "This invite link has expired. Ask for a new one.",
      invite_revoked: "This invite link was withdrawn.",
      invite_not_found: "This invite link isn't valid. Check you copied all of it.",
      invite_email: "This invite is for a different email address. Sign in with the address it was sent to.",
    });
    for (const code of Object.keys(INVITE_MESSAGES) as (keyof typeof INVITE_MESSAGES)[]) {
      expect(inviteError({ message: code }), code).toBe(INVITE_MESSAGES[code]);
    }
    for (const code of Object.keys(SLUG_MESSAGES) as (keyof typeof SLUG_MESSAGES)[]) {
      expect(inviteError(new Error(code)), code).toBe(SLUG_MESSAGES[code]);
    }
  });

  it("gives the generic sentence for other RPC codes, partial matches and things that aren't errors", () => {
    for (const e of [
      new Error("not_signed_in"), new Error("already_member"), new Error("invalid_role"), new Error("invalid_email"),
      new Error("not_member"), { message: "invite_used because" }, { message: " invite_used" }, { message: "toString" },
      { message: "constructor" }, { message: "__proto__" }, null, undefined, "invite_used", 42, {},
    ]) {
      expect(inviteError(e), String((e as { message?: unknown })?.message ?? e)).toBe("Something went wrong. Try the link again.");
    }
  });
});

describe("hashToken", () => {
  it("hashes tokens the way Postgres does", () => {
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("inviteProblem", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  const open = { used_at: null, revoked_at: null, expires_at: "2026-10-17T12:00:00Z" };
  it("is null for an open invite", () => {
    expect(inviteProblem(open, now)).toBeNull();
  });
  it("checks in the same order as the RPCs: missing, used, withdrawn, expired", () => {
    expect(inviteProblem(null, now)).toBe("invite_not_found");
    expect(inviteProblem({ ...open, used_at: "2026-10-16T11:00:00Z", revoked_at: "2026-10-16T11:00:00Z", expires_at: "2026-10-01T00:00:00Z" }, now)).toBe("invite_used");
    expect(inviteProblem({ ...open, revoked_at: "2026-10-16T11:00:00Z", expires_at: "2026-10-01T00:00:00Z" }, now)).toBe("invite_revoked");
    expect(inviteProblem({ ...open, expires_at: "2026-10-01T00:00:00Z" }, now)).toBe("invite_expired");
  });
  it("treats the expiry instant itself as expired, like expires_at <= now()", () => {
    expect(inviteProblem({ ...open, expires_at: "2026-10-16T12:00:00Z" }, now)).toBe("invite_expired");
  });
});

describe("isEmail", () => {
  it("takes the same shape invite_member accepts", () => {
    for (const e of ["a@b.co", "first.last+tag@sub.example.com"]) expect(isEmail(e), e).toBe(true);
    for (const e of ["", "a", "a@b", "a b@c.de", "@b.co", "a@@b.co", "a@b.co ", "x".repeat(250) + "@b.co"]) expect(isEmail(e), e).toBe(false);
  });
});
