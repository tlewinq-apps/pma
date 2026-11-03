import { it, expect, describe } from "vitest";
import { quickWinBlocks, draftReadyBlocks } from "@/lib/slack/blocks";
it("builds a compact quick-win message with escaped text and link buttons", () => {
  const b = quickWinBlocks({ title: "Early pickup <fails>", type: "bug", importance: 86, people: 1, quote: "It showed a spinner & went back", author: "Jordan", flow: "pickup › Notify", url: "https://v.app/?issue=1", prUrl: null });
  const json = JSON.stringify(b);
  expect(json).toContain("&lt;fails&gt;"); expect(json).toContain("&amp;"); expect(json).toContain("Open in PMA"); expect(json).not.toContain("Open PR");
});

describe("draftReadyBlocks", () => {
  const full = { title: "Early <pickup> & more", type: "bug" as const, importance: 86, prUrl: "https://github.com/o/r/pull/1", marverUrl: "https://github.com/o/r/tree/b/design", pmaUrl: "https://v.app/?issue=1", beforeUrl: "https://s.co/before.png", afterUrl: "https://s.co/after.png" };
  type B = { type: string; elements?: { text: { text: string } }[] };
  const of = (b: B[], t: string) => b.filter((x) => x.type === t);
  const labels = (b: B[]) => of(b, "actions").flatMap((a) => (a.elements ?? []).map((e) => e.text.text));

  it("has 2 images and 3 buttons when everything is present", () => {
    const b = draftReadyBlocks(full) as B[];
    expect(of(b, "image")).toEqual([
      { type: "image", image_url: full.beforeUrl, alt_text: "Current" },
      { type: "image", image_url: full.afterUrl, alt_text: "Proposed" },
    ]);
    expect(labels(b)).toEqual(["Open PR", "Open in Marver", "Open in PMA"]);
    expect(JSON.stringify(of(b, "section"))).toContain("Draft ready: *");
    expect(JSON.stringify(of(b, "section"))).toContain("Bug");
    expect(JSON.stringify(of(b, "section"))).not.toContain("86");
  });
  it("omits image blocks when shots are missing", () => {
    const b = draftReadyBlocks({ ...full, beforeUrl: null, afterUrl: undefined }) as B[];
    expect(of(b, "image")).toHaveLength(0);
  });
  it("omits buttons whose URL is not https", () => {
    const b = draftReadyBlocks({ ...full, prUrl: "http://evil/pr", marverUrl: null }) as B[];
    expect(labels(b)).toEqual(["Open in PMA"]);
  });
  it("escapes the title", () => {
    const json = JSON.stringify(draftReadyBlocks(full));
    expect(json).toContain("Early &lt;pickup&gt; &amp; more");
    expect(json).not.toContain("<pickup>");
  });
});

describe("legacy webhook blocks use the app's words", () => {
  const EMOJI = /\p{Extended_Pictographic}/u;
  it("show no score, say nothing of importance, and carry no emoji", () => {
    const quick = JSON.stringify(quickWinBlocks({ title: "Early pickup", type: "bug", importance: 86, people: 1, quote: "q", author: null, flow: null, url: "https://v.app/i/1", prUrl: null }));
    const ready = JSON.stringify(draftReadyBlocks({ title: "Early pickup", type: "bug", importance: 86 }));
    for (const json of [quick, ready]) {
      expect(json).not.toMatch(/Priority|86/);
      expect(json).not.toMatch(/importance/i);
      expect(json).not.toMatch(EMOJI);
    }
  });
});
