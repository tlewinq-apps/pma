import { describe, it, expect } from "vitest";
import { cachedSlackMatches } from "@/lib/slack/users";

describe("cachedSlackMatches", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();
  const members = [{ userId: "u1", email: "a@x.is" }, { userId: "u2", email: "b@x.is" }, { userId: "u3", email: "c@x.is" }];

  it("trusts a match checked in the last day and looks up everyone else", () => {
    const r = cachedSlackMatches(members, [{ user_id: "u1", checked_at: hoursAgo(2) }, { user_id: "u2", checked_at: hoursAgo(25) }], now);
    expect([...r.matched]).toEqual(["u1"]);
    expect(r.lookUp.map((m) => m.userId)).toEqual(["u2", "u3"]);
  });
  it("doesn't count Slack users who aren't members", () => {
    expect(cachedSlackMatches(members, [{ user_id: null, checked_at: hoursAgo(1) }], now).lookUp).toEqual(members);
  });
});
