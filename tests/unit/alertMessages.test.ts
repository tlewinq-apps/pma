import { describe, it, expect } from "vitest";
import { alertMessage, alertThreadText, buildDigest, digestMessage } from "@/lib/alerts/messages";

const EMOJI = /\p{Extended_Pictographic}/u;
const now = Date.parse("2026-10-15T12:00:00Z");
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();

describe("alertMessage", () => {
  const base = {
    issueId: "0b9e6a3c-1d2f-4a5b-8c7d-9e0f1a2b3c4d", title: "Photo opens <log you out>", type: "bug" as const, url: "https://v.app/issues/1",
    importance: 72, severity: 5, people: 2, reach: 0.9, quote: { text: "It logs me out every time", author: "Jordan Lee" },
  };
  it("says what happened, why it matters, and what to do next, without emoji", () => {
    const m = alertMessage({ ...base, rule: "blocking_bug", detail: { priority: 72, new: true } });
    const json = JSON.stringify(m);
    expect(m.text).toBe("New bug that blocks people: Photo opens <log you out>");
    expect(json).toContain("*New bug that blocks people:* <https://v.app/issues/1|Photo opens &lt;log you out&gt;>");
    expect(json).toContain("Blocker  ·  2 people  ·  Core flow");
    expect(json).not.toContain("72");
    expect(json).toContain("It logs me out every time");
    expect(json).not.toContain("Take it on");
    expect(json).toContain("Open in PMA");
    expect(json).not.toMatch(EMOJI);
  });
  it("counts people in a customer app's audience words when it has them, and keeps person and people otherwise", () => {
    expect(JSON.stringify(alertMessage({ ...base, people: 1, peopleText: "1 shopper", rule: "blocking_bug", detail: { priority: 72, new: true } }))).toContain("Blocker  ·  1 shopper  ·  Core flow");
    const demo = JSON.stringify(alertMessage({ ...base, people: 1, rule: "blocking_bug", detail: { priority: 72, new: true } }));
    expect(demo).toContain("Blocker  ·  1 person  ·  Core flow");
  });
  it("offers the type's first step while the issue waits on it", () => {
    const json = JSON.stringify(alertMessage({ ...base, rule: "blocking_bug", detail: { priority: 72, new: true }, diagnose: true }));
    expect(json).toContain("Run diagnostics");
    expect(json).toContain("pma_diagnose");
    expect(json).toContain('"style":"primary"');
    expect(JSON.stringify(alertMessage({ ...base, type: "streamline" as never, rule: "jump", detail: {}, diagnose: true }))).toContain("Map the steps");
  });
  it("says when a known bug has only now started blocking people", () => {
    expect(alertMessage({ ...base, rule: "blocking_bug", detail: { priority: 81, new: false } }).text).toBe("This bug now blocks people: Photo opens <log you out>");
  });
  it("explains a jump with where it came from", () => {
    const json = JSON.stringify(alertMessage({ ...base, rule: "jump", detail: { from: 52, to: 71 }, reason: "3 more people" }));
    expect(json).toContain("*Rising fast since yesterday:*");
    expect(json).toContain("3 more people.");
    expect(json).not.toMatch(/52|71/);
    expect(json).not.toContain("Take it on");
  });
});

describe("alertThreadText", () => {
  it("is the one-line note in the card thread, naming who was told", () => {
    expect(alertThreadText({ rule: "blocking_bug", priority: 72, new: true, sent_to: ["Sam", "Priya"] })).toBe("New bug that blocks people. Sent to Sam and Priya.");
    expect(alertThreadText({ rule: "blocking_bug", priority: 81, new: false, sent_to: [] })).toBe("This bug now blocks people.");
    expect(alertThreadText({ rule: "jump", from: 52, to: 71, sent_to: [] })).toBe("Rising fast since yesterday.");
    expect(alertThreadText({ rule: "jump", from: 52, to: 71, sent_to: ["A", "B", "C"] })).toBe("Rising fast since yesterday. Sent to A, B and C.");
  });
});

describe("digest", () => {
  const issue = (o: Record<string, unknown>) => ({ id: "x", title: "T", type: "bug" as const, importance: 50 as number | null, status: "new", owner: null as string | null, createdAt: daysAgo(30), updatedAt: daysAgo(1), link: "https://v.app/issues/x", ...o });
  const issues = [
    issue({ id: "a", title: "A", importance: 90 }), issue({ id: "b", title: "B", importance: 40, createdAt: daysAgo(2) }),
    issue({ id: "c", title: "C", importance: 70, owner: "Thomas" }), issue({ id: "d", title: "D", importance: 99, status: "shipped", updatedAt: daysAgo(3) }),
    issue({ id: "e", title: "E", importance: 95, status: "dismissed" }), issue({ id: "f", title: "F", importance: 10 }), issue({ id: "g", title: "G", importance: null }),
    issue({ id: "h", title: "H", importance: 60 }), issue({ id: "i", title: "I", importance: 80, status: "shipped", updatedAt: daysAgo(20) }),
  ];

  it("picks the five highest open issues, what is new this week, and what shipped this week", () => {
    const d = buildDigest(issues, now);
    expect(d.top.map((i) => i.id)).toEqual(["a", "c", "h", "b", "f"]);
    expect(d.fresh.map((i) => i.id)).toEqual(["b"]);
    expect(d.shipped.map((i) => i.id)).toEqual(["d"]);
  });

  it("reads as a short morning note with links and owners", () => {
    const json = JSON.stringify(digestMessage(buildDigest(issues, now), "https://v.app", now));
    expect(json).toContain("*Highest priority*");
    expect(json).toContain("• <https://v.app/issues/x|A>  ·  Bug  ·  Nobody on it yet");
    expect(json).toContain("Taken on by Thomas");
    expect(json).toContain("*New this week*  1");
    expect(json).toContain("*Shipped this week*  1");
    expect(json).not.toMatch(EMOJI);
  });

  it("says so when a section is empty", () => {
    const json = JSON.stringify(digestMessage(buildDigest([], now), "https://v.app", now));
    expect(json).toContain("Nothing open");
    expect(json).toContain("*Shipped this week*\\nNothing shipped yet");
  });
});
