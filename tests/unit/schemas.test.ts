import { describe, it, expect } from "vitest";
import { ExtractOut, ClassifyOut, RateOut, SolveOut } from "@/lib/pipeline/schemas";

describe("stage schemas", () => {
  it("accepts a well-formed extraction", () => {
    expect(ExtractOut.parse({ units: [{ quote: "It showed a spinner", speakers: ["Jordan Alvarez"], corroborators: [], reported_count: 0, relevant: true, filtered_reason: null }] }).units).toHaveLength(1);
  });
  it("rejects an unknown feedback type", () => {
    expect(() => ClassifyOut.parse({ items: [{ index: 0, type: "complaint", sentiment: -1, emotion: "frustrated", audience: "parents", job_code: null, signals: { blocks_task: true, has_workaround: false, data_loss: false, frequency_words: false } }] })).toThrow();
  });
  it("rate rubric is 1..5", () => {
    expect(() => RateOut.parse({ severity: 6, clarity: 3, scope: "copy", reach: 0.5, rationale: { severity: "", clarity: "", scope: "" } })).toThrow();
  });
  it("solve returns 1..3 options with exactly one recommended", () => {
    const ok = SolveOut.parse({ options: [{ title: "a", summary: "b", tradeoffs: "c", effort: "S", risk: "low", recommended: true, mode: "variant", target_frames: ["pickup/notify"] }] });
    expect(ok.options.filter((o) => o.recommended)).toHaveLength(1);
  });
});
