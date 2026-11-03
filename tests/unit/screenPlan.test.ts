import { describe, it, expect } from "vitest";
import { planScreenSync, assertLiveFrames } from "@/lib/marver/plan";

const row = (frame_id: string, title = frame_id) => ({ frame_id, title });

describe("planScreenSync", () => {
  it("dedupes incoming rows by frame_id keeping the first", () => {
    const { rows } = planScreenSync([], [row("a/x", "first"), row("b/y"), row("a/x", "second")]);
    expect(rows.map((r) => r.frame_id)).toEqual(["a/x", "b/y"]);
    expect(rows[0].title).toBe("first");
  });
  it("computes stale ids for existing screens no longer present", () => {
    const { staleIds } = planScreenSync([{ id: "1", frame_id: "a/x" }, { id: "2", frame_id: "gone/z" }], [row("a/x")]);
    expect(staleIds).toEqual(["2"]);
  });
  it("returns no stale ids when nothing is stale", () => {
    const { staleIds } = planScreenSync([{ id: "1", frame_id: "a/x" }], [row("a/x"), row("b/y")]);
    expect(staleIds).toEqual([]);
  });
  it("does not mark a duplicated-existing frame stale", () => {
    const { staleIds } = planScreenSync([{ id: "1", frame_id: "a/x" }], [row("a/x"), row("a/x")]);
    expect(staleIds).toEqual([]);
  });
});

describe("assertLiveFrames", () => {
  it("throws on zero frames", () => {
    expect(() => assertLiveFrames(0)).toThrow("Manifest has no live frames — refusing to change screens");
  });
  it("passes otherwise", () => { expect(() => assertLiveFrames(2)).not.toThrow(); });
});
