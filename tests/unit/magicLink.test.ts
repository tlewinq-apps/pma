import { describe, it, expect } from "vitest";
import { CALLBACK_OTP_TYPES, isCallbackOtpType, magicLinkUrl } from "@/lib/authLink";

const APP = "http://localhost:3000";

describe("magicLinkUrl", () => {
  it("verifies the token as the type Supabase made it for: a brand-new invitee's is a signup token", () => {
    const url = new URL(magicLinkUrl(APP, { hashed_token: "abc123", verification_type: "signup" }));
    expect(url.origin + url.pathname).toBe("http://localhost:3000/auth/callback");
    expect(url.searchParams.get("token_hash")).toBe("abc123");
    expect(url.searchParams.get("type")).toBe("signup");
    expect(url.searchParams.has("next")).toBe(false);
  });

  it("keeps magiclink for a confirmed account, and every type the callback verifies", () => {
    for (const t of ["magiclink", "signup", "invite", "email"]) {
      expect(new URL(magicLinkUrl(APP, { hashed_token: "h", verification_type: t })).searchParams.get("type"), t).toBe(t);
    }
  });

  it("adds a same-site next path, encoded, and drops a trailing slash on the app URL", () => {
    const url = magicLinkUrl(`${APP}/`, { hashed_token: "h", verification_type: "magiclink" }, "/invite/tok_en?x=1");
    expect(url).toBe("http://localhost:3000/auth/callback?token_hash=h&type=magiclink&next=%2Finvite%2Ftok_en%3Fx%3D1");
  });

  it("refuses a missing token, a type the callback can't verify, and a next that leaves the site", () => {
    expect(() => magicLinkUrl(APP, { hashed_token: "", verification_type: "magiclink" })).toThrow(/No link/);
    expect(() => magicLinkUrl(APP, { hashed_token: "h", verification_type: "recovery" })).toThrow(/recovery/);
    expect(() => magicLinkUrl(APP, { hashed_token: "h", verification_type: null })).toThrow();
    expect(() => magicLinkUrl(APP, { hashed_token: "h", verification_type: "magiclink" }, "https://evil.example")).toThrow(/path/);
    expect(() => magicLinkUrl(APP, { hashed_token: "h", verification_type: "magiclink" }, "//evil.example")).toThrow(/path/);
  });
});

describe("the callback's token types", () => {
  it("are the four generateLink and the email templates produce", () => {
    expect([...CALLBACK_OTP_TYPES].sort()).toEqual(["email", "invite", "magiclink", "signup"]);
    expect(isCallbackOtpType("signup")).toBe(true);
    expect(isCallbackOtpType("recovery")).toBe(false);
    expect(isCallbackOtpType(null)).toBe(false);
  });
});
