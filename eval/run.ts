// eval/run.ts — costs real API calls; run manually: npm run eval (loads .env.local itself)
import { readFileSync } from "node:fs";
import { callStructured } from "../src/lib/llm/client";
import { extractUnits } from "../src/lib/pipeline/extract";
import { classifyUnits } from "../src/lib/pipeline/classify";
import { DEMO_PRODUCT, DEMO_PROFILE } from "../src/lib/product/profile";
import { scoreEval } from "./score";

async function main() {
  const sources = JSON.parse(readFileSync("eval/fixtures/sources.json", "utf8")) as { id: string; author: string; channel: string; raw_text: string }[];
  const labels = JSON.parse(readFileSync("eval/fixtures/labels.json", "utf8")) as { source: string; match: string; type: string }[];
  const preds: { quote: string; type: string }[] = [];
  for (const s of sources) {
    // The eval data is the Celeste demo set.
    const units = await extractUnits(callStructured, { rawText: s.raw_text, author: s.author, channel: s.channel }, DEMO_PROFILE);
    const cls = await classifyUnits(callStructured, units, { jobs: [], fewShots: "", product: DEMO_PRODUCT });
    const byIdx = new Map(cls.map((c) => [c.index, c.type]));
    units.forEach((u, i) => { if (u.relevant) preds.push({ quote: u.quote, type: byIdx.get(i) ?? "irrelevant" }); });
  }
  const r = scoreEval(preds, labels);
  console.table({ "unit recall": r.recall.toFixed(2), "type accuracy": r.typeAccuracy.toFixed(2), "extra units": r.extra });
  if (r.recall < 0.85 || r.typeAccuracy < 0.75) {
    console.error("Below bar (recall >= 0.85, type >= 0.75)");
    process.exit(1);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
