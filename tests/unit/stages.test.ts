import { describe, it, expect, vi } from "vitest";
import { DEMO_PROFILE } from "@/lib/product/profile";
import { screenFromRoute, mapUnitToScreens } from "@/lib/pipeline/mapScreens";
import { decideCluster } from "@/lib/pipeline/cluster";
import type { StructuredCaller } from "@/lib/llm/client";

const cands = [
  { id: "s1", frame_id: "pickup/notify", scene: "pickup", title: "Notify school", description: null, copy_text: "Early pickup Send", similarity: 0.8 },
  { id: "s2", frame_id: "home/index", scene: "home", title: "Home", description: null, copy_text: "Notify school", similarity: 0.7 },
];

describe("screenFromRoute", () => {
  it("matches exact and prefix routes, longest prefix wins", () => {
    const map = { "/pickup": "pickup/index", "/pickup/early": "pickup/notify" };
    expect(screenFromRoute("/pickup/early?x=1", map)).toBe("pickup/notify");
    expect(screenFromRoute("/pickup/other", map)).toBe("pickup/index");
    expect(screenFromRoute(null, map)).toBeNull();
  });
});

describe("mapUnitToScreens", () => {
  it("drops frames the model invented and keeps model order", async () => {
    const llm = vi.fn().mockResolvedValue({ screens: [
      { frame_id: "home/index", confidence: 0.7, evidence: "opened Home" },
      { frame_id: "made/up", confidence: 0.9, evidence: "x" },
      { frame_id: "pickup/notify", confidence: 0.9, evidence: "tapped Early pickup" },
    ] }) as unknown as StructuredCaller;
    const out = await mapUnitToScreens(llm, "I opened Home, tapped Notify school, then Early pickup", cands, DEMO_PROFILE);
    expect(out.map((s) => s.frame_id)).toEqual(["home/index", "pickup/notify"]);
    expect(out[1].screen_id).toBe("s1");
  });
  it("returns [] without calling the model when there are no candidates", async () => {
    const llm = vi.fn() as unknown as StructuredCaller;
    expect(await mapUnitToScreens(llm, "q", [], DEMO_PROFILE)).toEqual([]);
    expect(llm).not.toHaveBeenCalled();
  });
});

describe("decideCluster", () => {
  it("creates when the model attaches to an id that was not a candidate", async () => {
    const llm = vi.fn()
      .mockResolvedValueOnce({ decision: "attach", issue_id: "nope", title: null, problem_statement: null })
      .mockResolvedValueOnce({ decision: "create", issue_id: null, title: "Early pickup fails silently", problem_statement: "p" }) as unknown as StructuredCaller;
    const res = await decideCluster(llm, "spinner then nothing", "bug", [{ id: "i1", title: "t", problem_statement: "p", type: "bug", similarity: 0.85 }], DEMO_PROFILE);
    expect(res).toEqual({ action: "create", title: "Early pickup fails silently", problemStatement: "p" });
  });
  it("attaches to a valid candidate", async () => {
    const llm = vi.fn().mockResolvedValue({ decision: "attach", issue_id: "i1", title: null, problem_statement: null }) as unknown as StructuredCaller;
    expect(await decideCluster(llm, "q", "bug", [{ id: "i1", title: "t", problem_statement: "p", type: "bug", similarity: 0.9 }], DEMO_PROFILE)).toEqual({ action: "attach", issueId: "i1" });
  });
});
