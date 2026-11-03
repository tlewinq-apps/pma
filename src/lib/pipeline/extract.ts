import type { StructuredCaller } from "@/lib/llm/client";
import { promptsFor } from "@/lib/llm/prompts";
import type { ProductProfile } from "@/lib/product/profile";
import { extractOutFor, type ExtractOutT } from "./schemas";
import { alignSpan, chunkText, dedupeUnitsBySpan, overlapRatio } from "@/lib/text";

export type ExtractedUnit = ExtractOutT["units"][number] & { span_start: number | null; span_end: number | null };

/** A span counts as a boundary-variant duplicate of an earlier chunk's unit at this overlap share. */
const BOUNDARY_DUPLICATE_RATIO = 0.8;

type Span = { start: number; end: number };

/**
 * The occurrence of `quote` a unit should claim: the first one not already claimed by an earlier unit
 * in the same chunk. If every occurrence is claimed, falls back to the first alignment and dedupe removes it.
 * Each retry searches from the end of the previous hit, so the search index strictly increases and the loop ends.
 */
function claimOccurrence(text: string, quote: string, claimed: Span[]): Span | null {
  const first = alignSpan(text, quote);
  if (!first) return null;
  const isClaimed = (s: Span) => claimed.some((c) => c.start === s.start && c.end === s.end);
  let span = first;
  while (isClaimed(span)) {
    const next = alignSpan(text, quote, span.end);
    if (!next) return first;
    span = next;
  }
  return span;
}

/** `profile`: the app the feedback is about (getProjectContext). */
export async function extractUnits(llm: StructuredCaller, src: { rawText: string; author: string | null; channel: string | null }, profile: ProductProfile): Promise<ExtractedUnit[]> {
  const system = promptsFor(profile).extract;
  const schema = extractOutFor(profile);
  const all: ExtractedUnit[] = [];
  const earlier: { start: number; end: number }[] = []; // aligned spans from previous chunks, full-text coordinates
  for (const chunk of chunkText(src.rawText)) {
    const out = await llm({
      system,
      user: `Source author: ${src.author ?? "unknown"}\nChannel: ${src.channel ?? "unknown"}\n\n<source>\n${chunk.text}\n</source>`,
      schema,
      effort: "medium",
    });
    // Within a chunk, a repeated quote that aligns to an already-claimed span claims its next occurrence.
    const claimed: { start: number; end: number }[] = [];
    const found: ExtractedUnit[] = [];
    for (const u of out.units) {
      const span = claimOccurrence(chunk.text, u.quote, claimed);
      if (span) claimed.push(span);
      found.push({ ...u, span_start: span ? span.start + chunk.offset : null, span_end: span ? span.end + chunk.offset : null });
    }
    // Chunks overlap, so the same point can be quoted from both with slightly different boundaries. Drop it here.
    for (const u of found) {
      if (u.span_start !== null && u.span_end !== null) {
        const span = { start: u.span_start, end: u.span_end };
        if (earlier.some((e) => overlapRatio(e, span) >= BOUNDARY_DUPLICATE_RATIO)) continue;
      }
      all.push(u);
    }
    for (const u of found) if (u.span_start !== null && u.span_end !== null) earlier.push({ start: u.span_start, end: u.span_end });
  }
  return dedupeUnitsBySpan(all);
}
