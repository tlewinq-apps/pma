import type { StructuredCaller } from "@/lib/llm/client";
import { promptsFor } from "@/lib/llm/prompts";
import type { AppProduct } from "@/lib/product/profile";
import { classifyOutFor, type ClassifiedItem } from "./schemas";
import type { ExtractedUnit } from "./extract";

export async function classifyUnits(
  llm: StructuredCaller,
  units: ExtractedUnit[],
  /** `product`: the app's profile and audiences together (getProjectContext's productOf). */
  ctx: { jobs: { code: string; title: string }[]; fewShots: string; product: AppProduct },
): Promise<ClassifiedItem[]> {
  const relevant = units.map((u, index) => ({ u, index })).filter((x) => x.u.relevant);
  if (relevant.length === 0) return [];
  const catalog = ctx.jobs.map((j) => `${j.code}: ${j.title}`).join("\n") || "(no job catalog)";
  const out = await llm({
    system: `${promptsFor(ctx.product.profile).classify}\n\nJob catalog:\n${catalog}\n\nTeam corrections to learn from:\n${ctx.fewShots || "(none)"}`,
    user: relevant.map((x) => `[${x.index}] (${x.u.speakers.join(", ")}) ${x.u.quote}`).join("\n"),
    schema: classifyOutFor(ctx.product.audiences),
    effort: "low",
  });
  const valid = new Set(relevant.map((x) => x.index));
  return out.items.filter((i) => valid.has(i.index));
}
