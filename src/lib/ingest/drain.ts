/**
 * After this long, a batch stops starting new sources and hands the rest to a fresh function. Vercel stops a function
 * at maxDuration (300 s), and one source can take two minutes (the first in a batch, which opens and scores an issue).
 */
export const DRAIN_BUDGET_MS = 120_000;

export type DrainDeps = {
  process: (id: string) => Promise<void>;
  /** Starts a fresh invocation for the ids left over. */
  handOff: (ids: string[]) => Promise<void>;
  now?: () => number;
  budgetMs?: number;
};

/**
 * Runs queued sources one at a time, in order, so a batch of files about the same new problem lands on one issue
 * instead of racing to open several. The first source always runs; the rest wait for a fresh invocation once the
 * budget is spent.
 */
export async function drainSources(ids: string[], deps: DrainDeps): Promise<void> {
  const now = deps.now ?? Date.now;
  const started = now();
  for (let k = 0; k < ids.length; k++) {
    if (k > 0 && now() - started > (deps.budgetMs ?? DRAIN_BUDGET_MS)) return deps.handOff(ids.slice(k));
    await deps.process(ids[k]);
  }
}
