import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { consumeCallbackToken, prStateToStatus, branchName, validShotPath, parseCallbackBody } from "@/lib/drafts/callback";
import { verifyGithubSignature } from "@/lib/github/verify";
describe("drafts", () => {
  it("token: ok once, then replayed; wrong token invalid", () => {
    expect(consumeCallbackToken({ callback_token: "t", callback_used_at: null }, "t")).toBe("ok");
    expect(consumeCallbackToken({ callback_token: "t", callback_used_at: "2026-10-15" }, "t")).toBe("replayed");
    expect(consumeCallbackToken({ callback_token: "t", callback_used_at: null }, "x")).toBe("invalid");
  });
  it("maps PR events to issue status", () => {
    expect(prStateToStatus("opened", false)).toBe("draft_ready");
    expect(prStateToStatus("submitted", false, "commented")).toBe("in_review");
    expect(prStateToStatus("closed", true)).toBe("shipped");
    expect(prStateToStatus("closed", false)).toBe("dismissed");
    expect(prStateToStatus("labeled", false)).toBeNull();
  });
  it("branch names are safe and unique per draft", () => {
    expect(branchName("a1b2c3", "Early pickup fails silently!", "9f8e7d6c-1111-2222-3333-444455556666")).toBe("pma/a1b2c3-early-pickup-fails-silently-9f8e7d");
    expect(branchName("a1b2c3", "x".repeat(80), "abcdef12-0000")).toBe(`pma/a1b2c3-${"x".repeat(40)}-abcdef`);
    expect(branchName("a1b2c3", "Same title", "111111aa-0")).not.toBe(branchName("a1b2c3", "Same title", "222222bb-0"));
    expect(branchName("a1b2c3", "ends with dash " + "a".repeat(25) + " b", "abcdef12")).not.toMatch(/--/);
  });
  it("verifies GitHub HMAC", () => {
    const body = '{"a":1}'; const sig = "sha256=" + createHmac("sha256", "s").update(body).digest("hex");
    expect(verifyGithubSignature("s", body, sig)).toBe(true); expect(verifyGithubSignature("s", body, "sha256=bad")).toBe(false); expect(verifyGithubSignature("s", body, null)).toBe(false);
  });
  describe("validShotPath", () => {
    const issue = "0b1c2d3e-aaaa-bbbb-cccc-111122223333";
    const draft = "9f8e7d6c-1111-2222-3333-444455556666";
    it("accepts own slot paths", () => {
      expect(validShotPath(`${issue}/${draft}/slot-0.png`, issue, draft)).toBe(true);
      expect(validShotPath(`${issue}/${draft}/slot-23.png`, issue, draft)).toBe(true);
    });
    it("rejects other drafts, traversal, bad names", () => {
      expect(validShotPath(`${issue}/other-draft/slot-1.png`, issue, draft)).toBe(false);
      expect(validShotPath(`other-issue/${draft}/slot-1.png`, issue, draft)).toBe(false);
      expect(validShotPath(`${issue}/${draft}/../x/slot-1.png`, issue, draft)).toBe(false);
      expect(validShotPath(`${issue}/${draft}/slot-123.png`, issue, draft)).toBe(false);
      expect(validShotPath(`${issue}/${draft}/slot-1.svg`, issue, draft)).toBe(false);
      expect(validShotPath(`${issue}/${draft}/evil.png`, issue, draft)).toBe(false);
      expect(validShotPath(`${issue}/${draft}/slot-1.png/x`, issue, draft)).toBe(false);
      expect(validShotPath(42 as unknown as string, issue, draft)).toBe(false);
    });
  });
  describe("parseCallbackBody", () => {
    const ok = { draft_id: "d", token: "t", status: "ready", pr_url: "https://github.com/o/r/pull/3", pr_number: 3 };
    it("accepts valid ready and failed bodies", () => {
      expect(parseCallbackBody(ok).ok).toBe(true);
      expect(parseCallbackBody({ draft_id: "d", token: "t", status: "failed", log_url: "https://github.com/o/r/actions/runs/1" }).ok).toBe(true);
    });
    it("rejects bad status, non-github urls, non-objects and missing fields", () => {
      expect(parseCallbackBody({ ...ok, status: "done" }).ok).toBe(false);
      expect(parseCallbackBody({ ...ok, status: undefined }).ok).toBe(false);
      expect(parseCallbackBody({ ...ok, pr_url: "https://evil.example/pull/3" }).ok).toBe(false);
      expect(parseCallbackBody({ ...ok, pr_url: "javascript:alert(1)" }).ok).toBe(false);
      expect(parseCallbackBody({ ...ok, pr_url: 5 }).ok).toBe(false);
      expect(parseCallbackBody({ ...ok, pr_url: undefined }).ok).toBe(false);
      expect(parseCallbackBody({ draft_id: "d", token: "t", status: "failed", log_url: "http://github.com/x" }).ok).toBe(false);
      expect(parseCallbackBody({ draft_id: "d", token: "t", status: "failed" }).ok).toBe(false);
      expect(parseCallbackBody({ ...ok, draft_id: 1 }).ok).toBe(false);
      expect(parseCallbackBody(null).ok).toBe(false);
      expect(parseCallbackBody("x").ok).toBe(false);
    });
  });
});

describe("ilikeExact (the webhook's repository match)", () => {
  it("escapes the ILIKE wildcards so a repository name only matches itself", async () => {
    const { ilikeExact } = await import("@/lib/github/prDraft");
    expect(ilikeExact("acme/my_app")).toBe("acme/my\\_app");
    expect(ilikeExact("a%b\\c")).toBe("a\\%b\\\\c");
    expect(ilikeExact("Acme/App.v2-x")).toBe("Acme/App.v2-x");
  });
});
