import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifySlackSignature } from "@/lib/slack/verify";

const secret = "8f742231b10e8888abcd99yyyzzz85a5";
const body = "token=xyz&team_id=T1&payload=%7B%7D";
const sign = (ts: string, raw = body, key = secret) => "v0=" + createHmac("sha256", key).update(`v0:${ts}:${raw}`).digest("hex");
const now = 1_760_000_000_000;
const ts = String(now / 1000);

describe("verifySlackSignature", () => {
  it("accepts a fresh, correctly signed request", () => {
    expect(verifySlackSignature(secret, body, ts, sign(ts), now)).toBe(true);
  });
  it("rejects a tampered body or the wrong secret", () => {
    expect(verifySlackSignature(secret, body + "x", ts, sign(ts), now)).toBe(false);
    expect(verifySlackSignature(secret, body, ts, sign(ts, body, "other"), now)).toBe(false);
  });
  it("rejects timestamps more than five minutes away (replays)", () => {
    const old = String(now / 1000 - 301);
    expect(verifySlackSignature(secret, body, old, sign(old), now)).toBe(false);
    const ok = String(now / 1000 - 299);
    expect(verifySlackSignature(secret, body, ok, sign(ok), now)).toBe(true);
  });
  it("rejects missing or malformed headers", () => {
    expect(verifySlackSignature(secret, body, null, sign(ts), now)).toBe(false);
    expect(verifySlackSignature(secret, body, ts, null, now)).toBe(false);
    expect(verifySlackSignature(secret, body, "abc", sign("abc"), now)).toBe(false);
    expect(verifySlackSignature(secret, body, ts, "v0=short", now)).toBe(false);
  });
});
