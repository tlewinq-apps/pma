import type { StructuredCaller } from "@/lib/llm/client";
import { promptsFor } from "@/lib/llm/prompts";
import type { ProductProfile } from "@/lib/product/profile";
import { RateOut, type RateOutT } from "./schemas";

export async function rateIssue(
  llm: StructuredCaller,
  issue: { title: string; problem_statement: string; type: string },
  quotes: string[],
  screens: string[],
  /** e.g. "4 of 6 say it blocks them · 2 have a workaround": anchors severity in what people said. */
  signals: string | null = null,
  /** The last rating: kept unless the quotes clearly change it, so more reports never make a score drift down. */
  previous: { severity: number; reach: number; clarity: number; scope: string } | null = null,
  /** The app the feedback is about (getProjectContext). */
  profile: ProductProfile,
): Promise<RateOutT> {
  return llm({
    system: promptsFor(profile).rate,
    user: [
      `Issue [${issue.type}]: ${issue.title}`,
      issue.problem_statement,
      `Screens: ${screens.join(" → ") || "unmapped"}`,
      ...(signals ? [`Signals: ${signals}`] : []),
      ...(previous ? [`Previous rating: severity ${previous.severity}, reach ${previous.reach}, clarity ${previous.clarity}, scope ${previous.scope}. Keep each value unless the quotes clearly show it was wrong or has changed; more reports of the same problem are not a reason to lower anything.`] : []),
      "Quotes:",
      ...quotes.map((q) => `- ${q}`),
    ].join("\n"),
    schema: RateOut,
    effort: "medium",
  });
}
