import type { StructuredCaller } from "@/lib/llm/client";
import { promptsFor } from "@/lib/llm/prompts";
import type { ProductProfile } from "@/lib/product/profile";
import { MapOut } from "./schemas";

export type ScreenCandidate = {
  id: string;
  frame_id: string;
  scene: string;
  title: string | null;
  description: string | null;
  copy_text: string | null;
  /** Cosine similarity to the quote; null when listed without embeddings. */
  similarity: number | null;
};

/** Longest matching route prefix wins. `routeMap` keys are path prefixes such as "/journal". */
export function screenFromRoute(route: string | null, routeMap: Record<string, string>): string | null {
  if (!route) return null;
  const path = route.split("?")[0].split("#")[0];
  const matches = Object.keys(routeMap)
    .filter((k) => path === k || path.startsWith(k.endsWith("/") ? k : `${k}/`))
    .sort((a, b) => b.length - a.length);
  return matches.length ? routeMap[matches[0]] : null;
}

export async function mapUnitToScreens(
  llm: StructuredCaller,
  quote: string,
  candidates: ScreenCandidate[],
  /** The app the feedback is about (getProjectContext). */
  profile: ProductProfile,
): Promise<{ screen_id: string; frame_id: string; confidence: number; evidence: string }[]> {
  if (candidates.length === 0) return [];
  const list = candidates
    .map((c) => `- ${c.frame_id} | ${c.title ?? ""} | ${c.description ?? ""} | copy: ${(c.copy_text ?? "").slice(0, 400)}`)
    .join("\n");
  const out = await llm({
    system: promptsFor(profile).map,
    user: `Candidate frames:\n${list}\n\nFeedback:\n${quote}`,
    schema: MapOut,
    effort: "medium",
  });
  const byFrame = new Map(candidates.map((c) => [c.frame_id, c]));
  return out.screens
    .filter((s) => byFrame.has(s.frame_id))
    .map((s) => ({
      screen_id: byFrame.get(s.frame_id)!.id,
      frame_id: s.frame_id,
      confidence: s.confidence,
      evidence: s.evidence,
    }));
}
