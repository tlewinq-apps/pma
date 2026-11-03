import { describe, it, expect, vi } from "vitest";
import { DEMO_PROFILE } from "@/lib/product/profile";
import { extractUnits } from "@/lib/pipeline/extract";
import type { StructuredCaller } from "@/lib/llm/client";

const RAW = "Parent: It showed a spinner and went back to Home.\nStaff: Sorry about that.";

describe("extractUnits", () => {
  it("aligns spans, keeps unalignable quotes with null span, filters nothing silently", async () => {
    const llm = vi.fn().mockResolvedValue({ units: [
      { quote: "It showed a spinner and went back to Home.", speakers: ["Parent"], corroborators: [], reported_count: 0, relevant: true, filtered_reason: null },
      { quote: "Sorry about that (paraphrased)", speakers: ["Staff"], corroborators: [], reported_count: 0, relevant: false, filtered_reason: "staff reply" },
    ] }) as unknown as StructuredCaller;
    const units = await extractUnits(llm, { rawText: RAW, author: "Jordan", channel: "call" }, DEMO_PROFILE);
    expect(units).toHaveLength(2);
    expect(RAW.slice(units[0].span_start!, units[0].span_end!)).toBe("It showed a spinner and went back to Home.");
    expect(units[1].span_start).toBeNull();
    expect(units[1].relevant).toBe(false);
  });

  it("keeps two identical short quotes in one source as separate units", async () => {
    const raw = "Staff: Same here.\nParent: Same here.";
    const llm = vi.fn().mockResolvedValue({ units: [
      { quote: "Same here", speakers: ["Staff"], corroborators: [], reported_count: 0, relevant: true, filtered_reason: null },
      { quote: "Same here", speakers: ["Parent"], corroborators: [], reported_count: 0, relevant: true, filtered_reason: null },
    ] }) as unknown as StructuredCaller;
    const units = await extractUnits(llm, { rawText: raw, author: null, channel: null }, DEMO_PROFILE);
    expect(units).toHaveLength(2);
    expect(units[0].span_start).not.toBe(units[1].span_start);
    for (const u of units) expect(raw.slice(u.span_start!, u.span_end!)).toBe("Same here");
  });

  it("keeps three identical short quotes in one source as three distinct spans", async () => {
    const raw = "Staff: Same here.\nParent: Same here.\nStaff: Same here.";
    const unit = { quote: "Same here", speakers: ["Parent"], corroborators: [], reported_count: 0, relevant: true, filtered_reason: null };
    const llm = vi.fn().mockResolvedValue({ units: [unit, { ...unit }, { ...unit }] }) as unknown as StructuredCaller;
    const units = await extractUnits(llm, { rawText: raw, author: null, channel: null }, DEMO_PROFILE);
    expect(units).toHaveLength(3);
    const starts = units.map((u) => u.span_start);
    expect(new Set(starts).size).toBe(3);
    for (const u of units) expect(raw.slice(u.span_start!, u.span_end!)).toBe("Same here");
  });

  it("collapses a repeated quote that has only one occurrence in the source", async () => {
    const raw = "Parent: Same here, only once.";
    const unit = { quote: "Same here", speakers: ["Parent"], corroborators: [], reported_count: 0, relevant: true, filtered_reason: null };
    const llm = vi.fn().mockResolvedValue({ units: [unit, { ...unit }] }) as unknown as StructuredCaller;
    const units = await extractUnits(llm, { rawText: raw, author: null, channel: null }, DEMO_PROFILE);
    expect(units).toHaveLength(1);
  });

  it("merges a boundary-variant duplicate from overlapping chunks into one unit", async () => {
    // 28,543 chars: chunk 1 = [0, 24000), chunk 2 = [23000, end). The quote sits at 23500, inside the overlap.
    const quote = "It showed a spinner and went back to Home.";
    const raw = "a".repeat(23500) + quote + "b".repeat(5000);
    const base = { speakers: ["Parent"], corroborators: [], reported_count: 0, relevant: true, filtered_reason: null };
    const llm = vi.fn()
      .mockResolvedValueOnce({ units: [{ ...base, quote }] })
      .mockResolvedValueOnce({ units: [{ ...base, quote: "showed a spinner and went back to Home." }] }) as unknown as StructuredCaller;
    const units = await extractUnits(llm, { rawText: raw, author: null, channel: null }, DEMO_PROFILE);
    expect(vi.mocked(llm)).toHaveBeenCalledTimes(2);
    expect(units).toHaveLength(1);
    expect(units[0].span_start).toBe(23500);
  });
});
