import { integrationRows, type HealthFacts, type HealthState } from "@/lib/health";

const TONE: Record<HealthState, string> = { Live: "text-tone-positive", Simulated: "text-tone-caution", Missing: "text-tone-negative" };

/** What's live, what's standing in with a built-in simulation, and what's missing, with the fix for each. */
export function DemoHealthCard({ facts }: { facts: HealthFacts }) {
  const rows = integrationRows(facts);
  const missing = rows.filter((r) => r.state === "Missing").length;
  return (
    <section className="space-y-3 surface p-5 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-lg font-semibold">Demo health</h2>
        <span className="text-xs text-muted-foreground">{missing ? `${missing} missing` : "Everything works end to end"}</span>
      </div>
      <dl className="divide-y divide-border">{rows.map((r) => (
        <div key={r.name} className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[10rem_5.5rem_1fr]">
          <dt className="font-medium">{r.name}</dt>
          <dd className={TONE[r.state]}>{r.state}</dd>
          <dd className="col-span-2 text-muted-foreground sm:col-span-1">{r.detail}{r.fix && r.state !== "Live" && <span className="block text-xs text-foreground/80">{r.fix}</span>}</dd>
        </div>))}
      </dl>
    </section>
  );
}
