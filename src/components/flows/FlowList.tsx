// The Flows tab: each Marver flow as a row of its real screens in step order, joined by the tap that leads on, with the
// open issues and praise under each screen. A server component: the frames arrive parsed and are drawn as plain divs.
import Link from "next/link";
import { ChevronRight, ExternalLink } from "lucide-react";
import { FRAME_H, FRAME_W, FrameThumb } from "@/components/marver/FrameView";
import { IMPACT_TONE, impactLabel } from "@/components/triage/format";
import type { Journey, JourneyScreen } from "./journey";
import { appHref } from "@/lib/links";

const STEP_W = 208;
const OTHER_W = 120;
const CONNECTOR_W = 88;
const heightOf = (w: number) => Math.round((w * FRAME_H) / FRAME_W);

function Connector({ label, height }: { label: string | null; height: number }) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center gap-1 text-muted-foreground" style={{ width: CONNECTOR_W, height }}>
      <span aria-hidden className="flex items-center"><span className="h-px w-8 bg-foreground/35" /><ChevronRight className="-ml-1.5 size-3.5" /></span>
      {label && <span className="max-w-full px-1 text-center text-[11px] leading-tight"><span className="sr-only">Tap </span>{label}</span>}
    </div>
  );
}

const praiseWords = (n: number) => (n === 1 ? "Praised once" : n === 2 ? "Praised twice" : `Praised ${n} times`);

/** The picture of a screen and, under it, its title, its open issues with the worst impact, and its praise. */
function Screen({ s, width, label, base }: { s: JourneyScreen; width: number; label: string; base: string }) {
  const { issues, severity, praise } = s.note;
  const impact = impactLabel(severity);
  const border = { borderColor: issues ? "var(--brand)" : "var(--border)" };
  return (
    <figure className="shrink-0" style={{ width }}>
      {s.frame
        ? <FrameThumb frame={s.frame} width={width} label={label} className="lift rounded-xl border bg-white shadow-paper" style={border} />
        : <div role="img" aria-label={label} className="lift grid place-items-center rounded-xl border bg-card p-3 text-center text-xs text-muted-foreground shadow-paper" style={{ ...border, width, height: heightOf(width) }}>{s.title}</div>}
      <figcaption className="mt-2 space-y-0.5 text-xs leading-snug">
        <span className="block truncate text-sm font-medium" title={s.title}>{s.title}</span>
        {impact && <span className={`block font-semibold ${IMPACT_TONE[Math.round(severity!)]}`}>{impact}</span>}
        {issues
          ? <Link href={appHref(base, `/?q=${encodeURIComponent(s.title)}`)} className="link block w-fit text-foreground">{issues} open {issues === 1 ? "issue" : "issues"}</Link>
          : <span className="block text-muted-foreground">No open issues</span>}
        {praise > 0 && <span className="block text-tone-positive">{praiseWords(praise)}</span>}
      </figcaption>
    </figure>
  );
}

function FlowRow({ j, base }: { j: Journey; base: string }) {
  const n = j.steps.length;
  return (
    <section aria-labelledby={`flow-${j.board}`} className="surface grid gap-x-8 gap-y-4 p-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <header className="space-y-2">
        <h2 id={`flow-${j.board}`} className="font-heading text-2xl font-semibold leading-tight">{j.title}</h2>
        {j.description && <p className="text-sm text-muted-foreground">{j.description}</p>}
        <p className="text-xs text-muted-foreground">{n} {n === 1 ? "step" : "steps"} on the Marver board <code className="whitespace-nowrap text-foreground/80">{j.board}</code></p>
        {j.canvasUrl && <a href={j.canvasUrl} target="_blank" rel="noreferrer" className="press -ml-2.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"><ExternalLink className="size-3.5" />Open in Marver</a>}
      </header>
      <ol className="-mx-3 -mt-2 flex items-start overflow-x-auto px-3 pt-2 pb-4">
        {j.steps.map((s, k) => (
          <li key={`${s.frame_id}-${k}`} className="flex items-start">
            {k > 0 && <Connector label={s.tap} height={heightOf(STEP_W)} />}
            <Screen s={s} width={STEP_W} label={`${j.title}, step ${k + 1} of ${n}: ${s.title}`} base={base} />
          </li>
        ))}
      </ol>
    </section>
  );
}

export function FlowList({ journeys, others, base }: { journeys: Journey[]; others: JourneyScreen[]; base: string }) {
  return (
    <div className="space-y-6">
      {journeys.length
        ? journeys.map((j) => <FlowRow key={j.board} j={j} base={base} />)
        : <p className="max-w-3xl text-sm text-muted-foreground">No flows on the Marver canvas yet. A flow is a board at <code>design/boards/flow-&lt;name&gt;.json</code> with its steps left to right; press Sync screens now in Settings to read it.</p>}
      {others.length > 0 && (
        <section aria-labelledby="flow-others" className="surface space-y-4 p-6">
          <header className="space-y-1">
            <h2 id="flow-others" className="font-heading text-2xl font-semibold leading-tight">{journeys.length ? "Other screens" : "Screens"}</h2>
            {journeys.length > 0 && <p className="text-sm text-muted-foreground">On the canvas but on no flow yet.</p>}
          </header>
          <ul className="flex flex-wrap gap-6">
            {others.map((s) => <li key={s.frame_id}><Screen s={s} width={OTHER_W} label={s.title} base={base} /></li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
