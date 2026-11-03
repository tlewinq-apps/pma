import type { StructuredCaller } from "@/lib/llm/client";
import { promptsFor } from "@/lib/llm/prompts";
import type { ProductProfile } from "@/lib/product/profile";
import { ClusterOut } from "./schemas";

export type IssueCandidate = {
  id: string;
  title: string;
  problem_statement: string;
  type: string;
  /** Cosine similarity to the quote; null when listed without embeddings. */
  similarity: number | null;
};

export type ClusterDecision =
  | { action: "attach"; issueId: string }
  | { action: "create"; title: string; problemStatement: string };

const MAX_ATTEMPTS = 2;

/**
 * Decides whether a unit belongs to an existing issue. An attach to an id that
 * was not offered as a candidate is treated as invalid and retried; if the
 * model never returns a usable decision, the unit becomes a new issue.
 */
export async function decideCluster(
  llm: StructuredCaller,
  quote: string,
  type: string,
  candidates: IssueCandidate[],
  /** The app the feedback is about (getProjectContext). */
  profile: ProductProfile,
): Promise<ClusterDecision> {
  const ids = new Set(candidates.map((c) => c.id));
  const list = candidates.length
    ? candidates.map((c) => `- id=${c.id} [${c.type}] ${c.title}: ${c.problem_statement}`).join("\n")
    : "(no existing issues are similar; you must create)";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const out = await llm({
      system: promptsFor(profile).cluster,
      user: `Existing issues:\n${list}\n\nNew unit [${type}]:\n${quote}`,
      schema: ClusterOut,
      effort: "low",
    });
    if (out.decision === "attach" && out.issue_id && ids.has(out.issue_id)) {
      return { action: "attach", issueId: out.issue_id };
    }
    if (out.decision === "create" && out.title && out.problem_statement) {
      return { action: "create", title: out.title, problemStatement: out.problem_statement };
    }
  }
  return {
    action: "create",
    title: quote.split(/\s+/).slice(0, 6).join(" "),
    problemStatement: quote,
  };
}
