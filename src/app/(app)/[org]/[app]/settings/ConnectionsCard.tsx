import { connectionRows, type ConnectionRow, type ConnectionState } from "@/lib/health";
import type { ToolCard } from "@/lib/connections/view";
import { ToolCards, type Flash } from "@/components/connections/ToolCards";

const TONE: Record<ConnectionState, string> = {
  Connected: "text-tone-positive", Live: "text-tone-positive", Beta: "text-tone-positive",
  "Not connected": "text-tone-caution", "Not seen yet": "text-muted-foreground", Missing: "text-tone-negative",
};

/**
 * A customer app's connections: a Connect card for each tool the company brings (its Claude key, Slack, Marver,
 * PostHog, Granola), then its repository and in-app widget in one plain line each.
 */
export function ConnectionsCard({ facts, cards, canEdit, returnTo, flash }: { facts: Parameters<typeof connectionRows>[0]; cards: ToolCard[]; canEdit: boolean; returnTo: string; flash: Flash }) {
  const rows: ConnectionRow[] = connectionRows(facts);
  return (
    <section id="connections" aria-labelledby="connections-title" className="scroll-mt-6 space-y-4 surface p-5 text-sm">
      <div className="space-y-1">
        <h2 id="connections-title" className="text-lg font-semibold">Connections</h2>
        <p className="text-muted-foreground">Each tool connects to your company&apos;s own account. Nothing is shared with other companies on PMA.</p>
      </div>
      <ToolCards cards={cards} canEdit={canEdit} returnTo={returnTo} flash={flash} />
      <dl className="divide-y divide-border">{rows.map((r) => (
        <div key={r.name} className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[9rem_6.5rem_1fr]">
          <dt className="font-medium">{r.name}</dt>
          <dd className={TONE[r.state]}>{r.state}</dd>
          <dd className="col-span-2 text-muted-foreground sm:col-span-1">{r.detail}</dd>
        </div>))}
      </dl>
    </section>
  );
}
