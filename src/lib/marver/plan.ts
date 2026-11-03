export function assertLiveFrames(count: number): void {
  if (count === 0) throw new Error("Manifest has no live frames — refusing to change screens");
}

/** Dedupe incoming rows by frame_id (first wins) and compute existing screen ids that are no longer present. */
export function planScreenSync<T extends { frame_id: string }>(
  existing: { id: string; frame_id: string }[],
  incoming: T[],
): { rows: T[]; staleIds: string[] } {
  const seen = new Set<string>();
  const rows: T[] = [];
  for (const r of incoming) {
    if (seen.has(r.frame_id)) continue;
    seen.add(r.frame_id);
    rows.push(r);
  }
  return { rows, staleIds: existing.filter((e) => !seen.has(e.frame_id)).map((e) => e.id) };
}
