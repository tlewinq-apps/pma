import { it, expect } from "vitest";
import { buildSegments } from "@/lib/highlights";
it("splits raw text into plain and highlighted segments, ignoring null and overlapping spans", () => {
  const raw = "Hello. It failed silently. I love it.";
  const segs = buildSegments(raw, [
    { id: "a", span_start: 7, span_end: 26, type: "bug", issue_id: "i1", filtered_reason: null },
    { id: "b", span_start: 10, span_end: 15, type: "bug", issue_id: "i1", filtered_reason: null },
    { id: "c", span_start: null, span_end: null, type: "praise", issue_id: null, filtered_reason: null },
    { id: "d", span_start: 27, span_end: 37, type: "praise", issue_id: null, filtered_reason: null },
  ]);
  expect(segs.map((s) => s.text).join("")).toBe(raw);
  expect(segs.filter((s) => s.unit).map((s) => s.unit!.id)).toEqual(["a", "d"]);
});
