// Where it happens: the issue's flow drawn from its real Marver screens, with the taps between them, and the steps the
// issue is on ringed in blue (the same mark Flows uses for a screen with open issues).
import { ChevronRight, ExternalLink } from "lucide-react";
import { FRAME_H, FRAME_W, FrameThumb } from "@/components/marver/FrameView";
import type { JourneyScreen } from "@/components/flows/journey";
import type { Placement } from "@/lib/queries/issueAnalysis";

const W = 116;
const CONNECTOR_W = 76;
const H = Math.round((W * FRAME_H) / FRAME_W);

function Shot({ s, hit }: { s: JourneyScreen; hit: boolean }) {
  const ring = hit ? { outline: "2px solid var(--brand)", outlineOffset: 3 } : undefined;
  return (
    <figure className="shrink-0" style={{ width: W }}>
      {s.frame
        ? <FrameThumb frame={s.frame} width={W} label={`${s.title}${hit ? ", where it happens" : ""}`} className="rounded-lg border border-border bg-white shadow-paper" style={ring} />
        : <div role="img" aria-label={s.title} className="grid place-items-center rounded-lg border border-border bg-card p-2 text-center text-[11px] text-muted-foreground" style={{ width: W, height: H, ...ring }}>{s.title}</div>}
      <figcaption className={`mt-2.5 truncate text-[12px] ${hit ? "font-semibold text-foreground" : "text-muted-foreground"}`} title={s.title}>{s.title}</figcaption>
    </figure>
  );
}

function Connector({ label }: { label: string | null }) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center gap-1 text-muted-foreground" style={{ width: CONNECTOR_W, height: H }}>
      <span aria-hidden className="flex items-center"><span className="h-px w-7 bg-foreground/35" /><ChevronRight className="-ml-1.5 size-3.5" /></span>
      {label && <span className="max-w-full px-1 text-center text-[11px] leading-tight"><span className="sr-only">Tap </span>{label}</span>}
    </div>
  );
}

export function FlowPlacement({ p, evidence, match }: { p: Placement; evidence: string | null; match: string | null }) {
  const hit = new Set(p.affected);
  const j = p.journey;
  const off = p.offFlow.filter((s) => hit.has(s.frame_id));
  if (!j && !off.length) return <p className="text-[14px] text-muted-foreground">Not matched to a screen yet. Feedback that names a screen, or comes through the in-app widget, places it.</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[14px]">
        {p.place ? <span className="font-semibold">{p.place}</span> : <span className="font-semibold">Not on a flow board yet</span>}
        {match && <span className="text-muted-foreground">{match}</span>}
        {p.alsoOn > 0 && <span className="text-muted-foreground">Also on {p.alsoOn} other {p.alsoOn === 1 ? "flow" : "flows"}</span>}
        {j?.canvasUrl && <a href={j.canvasUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"><ExternalLink aria-hidden className="size-3.5" />Open in Marver</a>}
      </div>
      <ol className="no-scrollbar -mx-2 flex items-start overflow-x-auto px-2 pt-2 pb-3" aria-label={j ? `${j.title}, step by step` : "Its screens"}>
        {(j ? j.steps : off).map((s, k) => (
          <li key={`${s.frame_id}-${k}`} className="flex items-start">
            {k > 0 && <Connector label={j ? j.steps[k].tap : null} />}
            <Shot s={s} hit={hit.has(s.frame_id)} />
          </li>
        ))}
      </ol>
      {evidence && <p className="max-w-[62ch] text-[14px] text-muted-foreground">Placed from their words: <span className="text-foreground">&ldquo;{evidence.replace(/^["\u201c]|["\u201d]$/g, "")}&rdquo;</span></p>}
    </div>
  );
}
