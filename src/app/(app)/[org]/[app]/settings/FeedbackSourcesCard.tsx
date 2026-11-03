import { feedbackSourceRows } from "@/lib/health";

/** Where feedback comes from, with honest states: Live only when something actually backs the source. */
export function FeedbackSourcesCard({ slackLive, widgetOrigins, customer = false, granolaLive = false, posthogLive = false, sentryLive = false }: { slackLive: boolean; widgetOrigins: number; customer?: boolean; granolaLive?: boolean; posthogLive?: boolean; sentryLive?: boolean }) {
  return (
    <section className="space-y-3 surface p-5 text-sm">
      <h2 className="text-lg font-semibold">Where feedback comes from</h2>
      <dl className="divide-y divide-border">{feedbackSourceRows({ slackLive, widgetOrigins, customer, granolaLive, posthogLive, sentryLive }).map((r) => (
        <div key={r.name} className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[9rem_1fr_auto]">
          <dt className="font-medium">{r.name}</dt>
          <dd className="order-last col-span-2 text-muted-foreground sm:order-none sm:col-span-1">{r.desc}</dd>
          <dd className={r.state === "Live" ? "text-tone-positive" : "text-muted-foreground"}>{r.state}</dd>
        </div>))}
      </dl>
    </section>
  );
}
