import { describe, it, expect } from "vitest";
import { chunkText, alignSpan, dedupeUnitsBySpan, contentHash, stripCaptions } from "@/lib/text";

const RAW = `Parent: Sure. I opened Home, tapped Notify school, then Early pickup.\n\nIt showed a spinner for maybe fifteen seconds and then the screen just went back to Home like nothing happened.`;

describe("alignSpan", () => {
  it("finds an exact quote", () => {
    const s = alignSpan(RAW, "It showed a spinner for maybe fifteen seconds")!;
    expect(RAW.slice(s.start, s.end)).toBe("It showed a spinner for maybe fifteen seconds");
  });
  it("tolerates collapsed whitespace and curly quotes", () => {
    const raw = "She said “no toast,  nothing” at all";
    const s = alignSpan(raw, '"no toast, nothing"')!;
    expect(raw.slice(s.start, s.end)).toBe("“no toast,  nothing”");
  });
  it("keeps the index map aligned when a character lowercases to several code units", () => {
    const raw = "İ said “no toast,  nothing” and more";
    const s = alignSpan(raw, '"no toast, nothing"')!;
    expect(raw.slice(s.start, s.end)).toBe("“no toast,  nothing”");
  });
  it("returns null for an empty or whitespace-only quote", () => {
    expect(alignSpan(RAW, "")).toBeNull();
    expect(alignSpan(RAW, "   ")).toBeNull();
  });
  it("searches from the given index so a repeated quote claims its next occurrence", () => {
    const raw = "Staff: Same here. Parent: Same here.";
    const first = alignSpan(raw, "Same here")!;
    const second = alignSpan(raw, "Same here", first.end)!;
    expect(raw.slice(second.start, second.end)).toBe("Same here");
    expect(second.start).toBeGreaterThan(first.start);
  });
  it("normalized search with from returns the second occurrence's raw indices (curly quotes)", () => {
    const raw = "Parent: She said “no toast,  nothing” then Staff: she said “no toast,  nothing” too.";
    const first = alignSpan(raw, '"no toast, nothing"')!;
    expect(raw.slice(first.start, first.end)).toBe("“no toast,  nothing”");
    const second = alignSpan(raw, '"no toast, nothing"', first.end)!;
    expect(second.start).toBe(raw.indexOf("“no toast", first.end));
    expect(raw.slice(second.start, second.end)).toBe("“no toast,  nothing”");
  });
  it("normalized search with from returns the second occurrence's raw indices (collapsed whitespace)", () => {
    const raw = "Staff: alpha   beta.  Parent: alpha   beta now";
    const first = alignSpan(raw, "alpha beta")!;
    expect(raw.slice(first.start, first.end)).toBe("alpha   beta");
    const second = alignSpan(raw, "alpha beta", first.end)!;
    expect(second.start).toBe(raw.indexOf("alpha   beta", first.end));
    expect(raw.slice(second.start, second.end)).toBe("alpha   beta");
  });
  it("tolerates a dropped speaker prefix and returns null when absent", () => {
    expect(alignSpan(RAW, "Sure. I opened Home, tapped Notify school")).not.toBeNull();
    expect(alignSpan(RAW, "the app crashed on login")).toBeNull();
  });
});

describe("chunkText", () => {
  it("returns one chunk for short text", () => expect(chunkText("abc", 100, 10)).toEqual([{ text: "abc", offset: 0 }]));
  it("covers a long text fully with overlap and correct offsets", () => {
    const text = Array.from({ length: 4000 }, (_, i) => `line ${i}`).join("\n"); // ~35k chars
    const chunks = chunkText(text, 10000, 500);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(text.slice(c.offset, c.offset + c.text.length)).toBe(c.text);
    expect(chunks.at(-1)!.offset + chunks.at(-1)!.text.length).toBe(text.length);
  });
  it("terminates and still covers the text when overlap exceeds the chunk size", () => {
    const text = "x".repeat(100);
    const chunks = chunkText(text, 10, 50);
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) expect(text.slice(c.offset, c.offset + c.text.length)).toBe(c.text);
    expect(chunks[0].offset).toBe(0);
    expect(chunks.at(-1)!.offset + chunks.at(-1)!.text.length).toBe(text.length);
  });
});

describe("dedupeUnitsBySpan", () => {
  it("drops units with the same span (from chunk overlap) and keeps null spans", () => {
    const out = dedupeUnitsBySpan([
      { span_start: 10, quote: "a" }, { span_start: 10, quote: "a" }, { span_start: null, quote: "b" }, { span_start: null, quote: "b" },
    ]);
    expect(out).toHaveLength(2);
  });
  it("keeps units with the same start but different ends", () => {
    const out = dedupeUnitsBySpan([
      { span_start: 10, span_end: 20, quote: "a" }, { span_start: 10, span_end: 40, quote: "b" },
    ]);
    expect(out).toHaveLength(2);
  });
});

describe("contentHash / stripCaptions", () => {
  it("hash ignores surrounding whitespace and case", () => expect(contentHash(" Hello\n")).toBe(contentHash("hello")));
  it("strips VTT timing and indices", () => {
    expect(stripCaptions("WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nParent: Hi\n\n2\n00:00:03.500 --> 00:00:05.000\nStaff: Hello")).toBe("Parent: Hi\nStaff: Hello");
  });
  it("turns VTT voice tags (Zoom, Teams) into Name: text and drops other cue tags", () => {
    expect(stripCaptions("WEBVTT\n\n00:00:01.000 --> 00:00:06.000\n<v Dana Whitfield>Hi, the <i>slip</i> won't sign.</v>\n\n00:00:06.500 --> 00:00:08.000\n<v.loud Support>Thanks <00:00:07.000><c>Dana</c>."))
      .toBe("Dana Whitfield: Hi, the slip won't sign.\nSupport: Thanks Dana.");
  });
});
