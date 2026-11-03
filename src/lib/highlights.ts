export type HUnit = { id: string; span_start: number | null; span_end: number | null; type: string; issue_id: string | null; filtered_reason: string | null };
export type Segment = { text: string; unit?: HUnit };
export function buildSegments(raw: string, units: HUnit[]): Segment[] {
  const spans = units.filter((u) => u.span_start !== null && u.span_end !== null && u.span_end > u.span_start).sort((a, b) => a.span_start! - b.span_start!);
  const out: Segment[] = []; let pos = 0;
  for (const u of spans) {
    if (u.span_start! < pos) continue;
    if (u.span_start! > pos) out.push({ text: raw.slice(pos, u.span_start!) });
    out.push({ text: raw.slice(u.span_start!, u.span_end!), unit: u }); pos = u.span_end!;
  }
  if (pos < raw.length) out.push({ text: raw.slice(pos) });
  return out;
}
