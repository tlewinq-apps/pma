// Follow-up questions for vague feedback: drafted when an issue's clarity is rated low, asked in the reporter's own
// Slack thread on request, and their replies come back as new feedback on the same issue.
import { z } from "zod";
import type { StructuredCaller } from "@/lib/llm/client";
import { promptsFor } from "@/lib/llm/prompts";
import type { ProductProfile } from "@/lib/product/profile";

const FollowupsOut = z.object({ questions: z.array(z.string()) });

/** Stored on issues.followups (migration 0014). */
export type Followups = { questions: string[]; drafted_at: string; asked_at?: string | null; asked?: string[] };

/** `profile`: the app the feedback is about (profileOf its project). */
export async function draftFollowups(llm: StructuredCaller, issue: { title: string; problem: string; quotes: string[] }, profile: ProductProfile): Promise<string[]> {
  const out = await llm({
    system: promptsFor(profile).followups,
    user: [`Issue: ${issue.title}`, issue.problem, "What people said:", ...issue.quotes.slice(0, 8).map((q) => `- ${q}`)].join("\n"),
    schema: FollowupsOut,
    effort: "low",
    maxTokens: 2000,
  });
  return out.questions.map((q) => q.trim()).filter(Boolean).slice(0, 2);
}
