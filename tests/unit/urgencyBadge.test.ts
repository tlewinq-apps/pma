import { describe, it, expect } from "vitest";
import { urgencyHue } from "@/components/triage/UrgencyBadge";

describe("urgencyHue", () => {
  it("runs green at 1, yellow at 5 and red at 10", () => {
    expect(urgencyHue(1)).toBe(140);
    expect(urgencyHue(5)).toBe(48);
    expect(urgencyHue(10)).toBe(4);
  });
  it("blends in between and only ever moves toward red", () => {
    const hues = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(urgencyHue);
    for (let k = 1; k < hues.length; k++) expect(hues[k]).toBeLessThan(hues[k - 1]);
  });
  it("holds the ends for scores outside 1 to 10", () => {
    expect(urgencyHue(0)).toBe(140);
    expect(urgencyHue(12)).toBe(4);
  });
});
