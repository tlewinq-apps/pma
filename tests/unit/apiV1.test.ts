import { describe, it, expect } from "vitest";
import { bearerToken, parseFeedbackBody, parseLane, FEEDBACK_MAX_CHARS } from "@/lib/api/v1";

describe("bearerToken", () => {
  it("extracts the token", () => expect(bearerToken("Bearer abc123")).toBe("abc123"));
  it("is case-insensitive on the scheme and trims", () => expect(bearerToken("bearer   abc123 ")).toBe("abc123"));
  it("rejects missing, empty or non-bearer headers", () => {
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken("")).toBeNull();
    expect(bearerToken("Bearer ")).toBeNull();
    expect(bearerToken("Bearer    ")).toBeNull();
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken("abc")).toBeNull();
  });
});

describe("parseLane", () => {
  it("treats absent lane as no filter", () => {
    expect(parseLane(null)).toEqual({ ok: true, lane: null });
    expect(parseLane("")).toEqual({ ok: true, lane: null });
  });
  it("accepts the four lanes", () => {
    for (const l of ["quick_win", "explore", "watch", "backlog"]) expect(parseLane(l)).toEqual({ ok: true, lane: l });
  });
  it("rejects unknown lanes", () => {
    expect(parseLane("urgent")).toMatchObject({ ok: false, status: 400 });
    expect(parseLane("QUICK_WIN")).toMatchObject({ ok: false, status: 400 });
  });
});

describe("parseFeedbackBody", () => {
  it("accepts text only, defaulting channel to API", () => {
    expect(parseFeedbackBody({ text: "  Pickup failed " })).toEqual({ ok: true, input: { raw_text: "Pickup failed", author: null, channel: "API", occurred_at: null, route: null } });
  });
  it("passes through optional fields", () => {
    expect(parseFeedbackBody({ text: "x", author: "Sam", channel: "Intercom", route: "/p", occurred_at: "2026-09-10T15:00:00Z" })).toEqual({
      ok: true, input: { raw_text: "x", author: "Sam", channel: "Intercom", occurred_at: "2026-09-10T15:00:00.000Z", route: "/p" },
    });
  });
  it("rejects non-object bodies and missing or blank text", () => {
    expect(parseFeedbackBody(null)).toMatchObject({ ok: false, status: 400 });
    expect(parseFeedbackBody("hi")).toMatchObject({ ok: false, status: 400 });
    expect(parseFeedbackBody({})).toMatchObject({ ok: false, status: 400 });
    expect(parseFeedbackBody({ text: "   " })).toMatchObject({ ok: false, status: 400 });
    expect(parseFeedbackBody({ text: 5 })).toMatchObject({ ok: false, status: 400 });
  });
  it("caps text at 200k chars", () => {
    expect(FEEDBACK_MAX_CHARS).toBe(200_000);
    expect(parseFeedbackBody({ text: "a".repeat(200_000) }).ok).toBe(true);
    expect(parseFeedbackBody({ text: "a".repeat(200_001) })).toMatchObject({ ok: false, status: 413 });
  });
  it("rejects a non-string author/channel/route or an invalid date", () => {
    expect(parseFeedbackBody({ text: "x", author: 3 })).toMatchObject({ ok: false, status: 400 });
    expect(parseFeedbackBody({ text: "x", channel: {} })).toMatchObject({ ok: false, status: 400 });
    expect(parseFeedbackBody({ text: "x", occurred_at: "not a date" })).toMatchObject({ ok: false, status: 400 });
  });
});
