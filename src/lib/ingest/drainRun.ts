import { env } from "@/lib/env";
import { runSource } from "@/lib/pipeline/deps";
import { drainSources } from "./drain";

/**
 * Runs queued sources through the pipeline in order (drainSources). Leftovers go to /api/cron/drain on the same
 * deployment (`origin`), which carries on the same way; if that call fails they stay queued for the cron sweep.
 */
export function runQueued(ids: string[], origin: string): Promise<void> {
  return drainSources(ids, {
    process: (id) => runSource(id),
    handOff: async (rest) => {
      const res = await fetch(`${origin}/api/cron/drain`, {
        method: "POST", headers: { authorization: `Bearer ${env.cronSecret()}`, "content-type": "application/json" }, body: JSON.stringify({ ids: rest }),
      }).catch((e: Error) => e);
      if (!(res instanceof Response) || !res.ok) console.error("[ingest] hand-off failed; the cron sweep will pick these up", res instanceof Response ? res.status : res.message, rest);
    },
  });
}
