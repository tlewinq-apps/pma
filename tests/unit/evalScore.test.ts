import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { scoreEval } from "../../eval/score";

it("matches predictions to gold by substring and scores type accuracy", () => {
  const r = scoreEval(
    [{ quote: "the app just spun for a while and then nothing happened", type: "bug" }, { quote: "There was no way to go back and fix it", type: "streamline" }, { quote: "hello", type: "bug" }],
    [{ match: "spun for a while and then nothing happened", type: "bug" }, { match: "no way to go back and fix it", type: "add_on" }, { match: "notification sound", type: "bug" }],
  );
  expect(r).toEqual({ recall: 2 / 3, typeAccuracy: 1 / 2, extra: 1 });
});

describe("eval fixtures", () => {
  const sources = JSON.parse(readFileSync("eval/fixtures/sources.json", "utf8")) as { id: string; raw_text: string }[];
  const labels = JSON.parse(readFileSync("eval/fixtures/labels.json", "utf8")) as { source: string; match: string; type: string }[];
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");

  it("has 4 sources and 14 gold units", () => {
    expect(sources.map((s) => s.id).sort()).toEqual(["call", "email", "note", "slack"]);
    expect(labels).toHaveLength(14);
  });

  it("every label's match occurs verbatim in its source's raw_text", () => {
    for (const l of labels) {
      const src = sources.find((s) => s.id === l.source);
      expect(src, `source ${l.source}`).toBeDefined();
      expect(src!.raw_text.includes(l.match), `"${l.match}" in ${l.source}`).toBe(true);
      expect(norm(src!.raw_text).includes(norm(l.match))).toBe(true);
    }
  });
});
