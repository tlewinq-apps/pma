const n = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Match predicted units to gold units by (normalised) substring in either direction.
 * Each prediction can satisfy at most one gold unit. `extra` counts predictions that matched nothing.
 */
export function scoreEval(pred: { quote: string; type: string }[], gold: { match: string; type: string }[]): { recall: number; typeAccuracy: number; extra: number } {
  const used = new Set<number>();
  let found = 0;
  let correct = 0;
  for (const g of gold) {
    const gm = n(g.match);
    const k = pred.findIndex((p, i) => {
      const pq = n(p.quote);
      return !used.has(i) && pq !== "" && gm !== "" && (pq.includes(gm) || gm.includes(pq));
    });
    if (k >= 0) {
      used.add(k);
      found++;
      if (pred[k].type === g.type) correct++;
    }
  }
  return { recall: gold.length ? found / gold.length : 0, typeAccuracy: found ? correct / found : 0, extra: pred.length - used.size };
}
