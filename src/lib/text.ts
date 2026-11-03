import { createHash } from "node:crypto";

const QUOTE_MAP: Record<string, string> = { "“": '"', "”": '"', "‘": "'", "’": "'" };

/** Normalize to a comparable form and keep a map from normalized index → raw index. */
function normalizeWithMap(raw: string): { norm: string; map: number[] } {
  let norm = ""; const map: number[] = []; let prevSpace = false;
  for (let i = 0; i < raw.length; i++) {
    let ch = QUOTE_MAP[raw[i]] ?? raw[i];
    if (/\s/.test(ch)) { if (prevSpace) continue; ch = " "; prevSpace = true; } else prevSpace = false;
    for (const c of ch.toLowerCase()) { norm += c; map.push(i); } // a char may lowercase to several code units
  }
  return { norm, map };
}

/** Find `quote` in `raw` at or after index `from`. Returns null for empty quotes or no match. */
export function alignSpan(raw: string, quote: string, from = 0): { start: number; end: number } | null {
  if (!quote.trim()) return null;
  const exact = raw.indexOf(quote, from);
  if (exact >= 0) return { start: exact, end: exact + quote.length };
  const { norm, map } = normalizeWithMap(raw);
  const q = normalizeWithMap(quote.trim()).norm.replace(/^"|"$/g, "");
  if (!q) return null;
  const nFrom = map.findIndex((m) => m >= from);
  if (nFrom < 0) return null;
  const idx = norm.indexOf(q, nFrom);
  if (idx < 0) return null;
  // widen to include wrapping quotes present in raw (never before `from`)
  let startN = idx, endN = idx + q.length;
  if (startN > nFrom && norm[startN - 1] === '"') startN--;
  if (norm[endN] === '"') endN++;
  return { start: map[startN], end: map[endN - 1] + 1 };
}

/** Share of the shorter span covered by the overlap of two spans, in [0, 1]. */
export function overlapRatio(a: { start: number; end: number }, b: { start: number; end: number }): number {
  const shorter = Math.min(a.end - a.start, b.end - b.start);
  if (shorter <= 0) return 0;
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start)) / shorter;
}

export function chunkText(text: string, maxChars = 24000, overlap = 1000): { text: string; offset: number }[] {
  if (text.length <= maxChars) return [{ text, offset: 0 }];
  const chunks: { text: string; offset: number }[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length) {
      const nl = text.lastIndexOf("\n", end);
      if (nl > start + maxChars / 2) end = nl + 1;
    }
    chunks.push({ text: text.slice(start, end), offset: start });
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1); // always advance, even if overlap is large
  }
  return chunks;
}

/** Drops units with an identical span (or identical quote when unaligned). Distinct spans are kept. */
export function dedupeUnitsBySpan<T extends { span_start: number | null; span_end?: number | null; quote: string }>(units: T[]): T[] {
  const seen = new Set<string>();
  return units.filter((u) => {
    const key = u.span_start !== null ? `s:${u.span_start}:${u.span_end ?? ""}` : `q:${u.quote.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex");
}

/** A source's dedupe hash: an explicit key when the input has a stable id (a Slack message), else its text. */
export const sourceHash = (rawText: string, key?: string | null) => (key ? createHash("sha256").update(`key\0${key}`).digest("hex") : contentHash(rawText));

export function stripCaptions(src: string): string {
  return src
    .split(/\r?\n/)
    .filter((l) => l.trim() && l.trim() !== "WEBVTT" && !/^\d+$/.test(l.trim()) && !/-->/.test(l))
    // Zoom and Teams name the speaker in a voice tag (<v Dana>Hi); extraction reads speakers from "Dana: Hi".
    .map((l) => l.replace(/^<v(?:\.[\w.-]+)?\s+([^>]+)>/, "$1: ").replace(/<[^>]*>/g, "").trim())
    .join("\n");
}
