"use client";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, TriangleAlert, X } from "lucide-react";
import { FrameThumb, FRAME_H, FRAME_W } from "@/components/marver/FrameView";
import { DETAIL, fitDetail, fitOverview, OVERVIEW, stepIndex, stepsFromFlow, stepsFromShots, type Shot, type Shots, type Step, type StepSide } from "@/lib/marver/flowLayout";
import type { FlowColumn, FlowView } from "@/lib/queries/flowView";
import type { IssueDetail } from "@/lib/queries/issueDetail";
import { isApproximate } from "@/lib/drafts/codeMockup";

export type { Shot, Shots };

/** The mock-up's own screens: today's shots (or the issue's screens by name) and the drafted ones. */
export function mockupShots(d: IssueDetail): Shots {
  const draft = d.draft;
  if (!draft) return { current: [], proposed: [] };
  // A screen drawn from code has no screen row: "code/result-popup" reads as "Result popup".
  const named = (id: string) => (id.startsWith("code/") ? `${id.slice(5).charAt(0).toUpperCase()}${id.slice(6).replace(/-/g, " ")}` || id : id);
  const title = (id: string) => d.flow.find((f) => f.frame_id === id)?.title ?? named(id);
  // An approximate mock-up's shots are drawn at the app's own size (a desktop window for the web): fitted, not cropped.
  const fit = isApproximate(draft, d.project) ? { contain: true } : {};
  return {
    current: draft.before.length ? draft.before.map((b) => ({ frame_id: b.frame_id, url: b.url, title: title(b.frame_id), ...fit })) : d.flow.map((f) => ({ frame_id: f.frame_id, title: f.title ?? f.frame_id })),
    proposed: draft.after.map((a) => ({ frame_id: a.frame_id, url: a.url, title: title(a.frame_id), ...fit })),
  };
}

/** The mock-up's one line on what changed, by screen: the large view's note when there is no full flow yet. */
export function mockupChanges(d: IssueDetail): Map<string, string | null> {
  return new Map((d.draft?.frames ?? []).map((f) => [f.frame_id, f.changed]));
}

const CHANGE = { same: "Same", changed: "Changed", new: "New" } as const;
const tall = (w: number) => Math.round((w * FRAME_H) / FRAME_W);

function Box({ w, children, dashed }: { w: number; children: React.ReactNode; dashed?: boolean }) {
  return (
    <div className={`grid place-items-center rounded-lg p-3 text-center text-xs text-muted-foreground ${dashed ? "border border-dashed border-foreground/25" : "bg-card"}`} style={{ width: w, height: tall(w) }}>
      {children}
    </div>
  );
}

function Connector({ label, width }: { label: string | null; width: number }) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center gap-1.5 self-stretch text-muted-foreground" style={{ width }}>
      <span aria-hidden className="flex items-center"><span className="h-px bg-foreground/35" style={{ width: Math.max(8, width - 40) }} /><ChevronRight className="-ml-1.5 size-3.5" /></span>
      {label && <span title={label} className="line-clamp-2 max-w-full px-2 text-center text-xs leading-snug">{label}</span>}
    </div>
  );
}

/* ---------- The Projects tab's small flow ---------- */

const COMPACT_LABEL_W = 60;
const COMPACT_CONNECTOR_W = 22;

function CompactCell({ side, w, touched, title, dashed, drafting }: { side: StepSide | null | undefined; w: number; touched?: boolean; title?: string; dashed?: boolean; drafting?: boolean }) {
  if (!side?.frame) return <div className="shrink-0" title={title}><Box w={w} dashed={dashed}>{drafting ? <Loader2 className="size-3.5 animate-spin" /> : ""}</Box></div>;
  return (
    <figure className="shrink-0" title={title}>
      <FrameThumb frame={side.frame} width={w} marks={touched} label={title ?? side.title} className="rounded-lg border shadow-paper" style={{ borderColor: touched ? "var(--brand)" : "var(--border)", opacity: touched === false ? 0.6 : 1 }} />
    </figure>
  );
}

/**
 * Today's flow over the proposed one, small, at frame width `w`: the Projects tab's preview. Step names and what
 * changed sit in tooltips; the full-flow pop-up draws the same steps large.
 */
export function FlowRows({ columns, w, drafting = false }: { columns: FlowColumn[]; w: number; drafting?: boolean }) {
  const steps = stepsFromFlow(columns);
  const row = (label: string, accent: boolean, cell: (s: Step) => React.ReactNode) => (
    <div className="flex items-start">
      <div className="shrink-0 pt-1 text-xs font-semibold" style={{ width: COMPACT_LABEL_W, color: accent ? "var(--brand)" : undefined }}>{label}</div>
      {steps.map((s, k) => (
        <div key={s.key} className="flex items-start">
          {k > 0 && <div className="flex" style={{ height: tall(w) }}><Connector label={null} width={COMPACT_CONNECTOR_W} /></div>}
          {cell(s)}
        </div>
      ))}
    </div>
  );
  return (
    <div className="inline-flex flex-col gap-3">
      {row("Current", false, (s) => <CompactCell side={s.current} w={w} title={s.current?.title} dashed={!s.current} />)}
      {row("Proposed", true, (s) => {
        const p = s.proposed;
        const touched = p ? p.change !== "same" : undefined;
        const title = p ? `${p.change ? CHANGE[p.change] : "Proposed"}: ${p.title}${touched && p.caption ? `. ${p.caption}` : ""}` : undefined;
        return <CompactCell side={p} w={w} touched={touched} title={title} drafting={drafting} />;
      })}
    </div>
  );
}

/* ---------- The pop-up ---------- */

/** The pop-up body's size, kept current by a ResizeObserver. A callback ref, so it measures whenever the body mounts,
 * including a dialog that opens with the page (?flow=1). */
function useBodySize() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return { measure: setEl, el, size };
}

/** A proposal touched this screen: changed, new, or a mock-up shot (which is always the changed screen). */
const isTouched = (p: Step["proposed"]) => !!p && p.change !== "same";

/** One side of a step at width `w`: the Marver frame, the mock-up's shot, or a box saying why there is neither. */
function ScreenFace({ step, side, w, drafting, lifts = false, dim = false }: { step: Step; side: "current" | "proposed"; w: number; drafting: boolean; lifts?: boolean; dim?: boolean }) {
  const s = step[side];
  const motion = lifts ? "transition-[translate,box-shadow] duration-300 ease-smooth group-hover:shadow-lift motion-safe:group-hover:-translate-y-0.5" : "";
  if (side === "current" && !s) return <Box w={w} dashed>Not in today&apos;s flow</Box>;
  if (side === "proposed" && !s) {
    return <Box w={w}>{drafting ? <span className="flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" />Planning</span> : "Not drawn"}</Box>;
  }
  const touched = side === "proposed" && isTouched(step.proposed);
  const label = side === "current" ? `Current: ${s!.title}` : `Proposed, ${step.proposed?.change ? CHANGE[step.proposed.change].toLowerCase() : "drafted"}: ${s!.title}`;
  const frameStyle = { borderColor: touched ? "var(--brand)" : "var(--border)", opacity: dim && side === "proposed" && !touched ? 0.6 : 1 };
  if (s!.frame) return <FrameThumb frame={s!.frame} width={w} marks={touched} label={label} className={`rounded-lg border shadow-paper ${motion}`} style={frameStyle} />;
  if (s!.url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={s!.url} alt={label} className={`rounded-lg border bg-card ${s!.contain ? "object-contain" : "object-cover object-top"} shadow-paper ${motion}`} style={{ ...frameStyle, width: w, height: tall(w) }} />;
  }
  return <Box w={w}>{drafting && side === "proposed" ? <span className="flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" />Drawing {s!.title}</span> : s!.title}</Box>;
}

/** What the proposal did to a step, in a word: Changed, New or Same, or nothing for a mock-up shot. */
function ChangeWord({ p }: { p: Step["proposed"] }) {
  if (!p?.change) return null;
  return <span className={isTouched(p) ? "font-semibold text-[var(--brand)]" : "text-muted-foreground"}>{CHANGE[p.change]}</span>;
}

/**
 * The whole flow, centred: one column per step, today's screen over the proposed one, the step's name above and what
 * changed below, so the two screens meet in the middle where they are compared. Each column opens that step large.
 */
function FlowOverview({ steps, size, drafting, linked, onOpen }: { steps: Step[]; size: { w: number; h: number }; drafting: boolean; linked: boolean; onOpen: (k: number) => void }) {
  const { w, h, gap, scrolls } = fitOverview({ bodyW: size.w, bodyH: size.h, steps: steps.length });
  const rows = (top: React.ReactNode, current: React.ReactNode, proposed: React.ReactNode, bottom: React.ReactNode) => (
    <>
      <div style={{ height: OVERVIEW.topCaption }}>{top}</div>
      <div className="flex" style={{ height: h }}>{current}</div>
      <div style={{ height: OVERVIEW.rowGap }} />
      <div className="flex" style={{ height: h }}>{proposed}</div>
      <div style={{ height: OVERVIEW.bottomCaption }}>{bottom}</div>
    </>
  );
  return (
    <div className="flex min-h-full w-max min-w-full">
      <div className="m-auto flex" style={{ padding: `${OVERVIEW.padY}px ${OVERVIEW.padX}px` }}>
        <div className="sticky left-0 z-10 flex shrink-0 flex-col bg-background text-sm font-semibold" style={{ width: OVERVIEW.gutter }}>
          {rows(null, <span className="self-center">Current</span>, <span className="self-center text-[var(--brand)]">Proposed</span>, null)}
        </div>
        {steps.map((s, k) => {
          const before = steps[k - 1];
          const p = s.proposed;
          return (
            <div key={s.key} className="flex">
              {k > 0 && (
                <div className="flex shrink-0 flex-col" style={{ width: gap }}>
                  {linked && rows(null,
                    before.current && s.current ? <Connector label={s.tapCurrent} width={gap} /> : null,
                    before.proposed && p ? <Connector label={s.tapProposed} width={gap} /> : null,
                    null)}
                </div>
              )}
              <button
                type="button" data-step={k} onClick={() => onOpen(k)}
                aria-label={`Open step ${k + 1} large: ${(p ?? s.current)?.title ?? "not drawn"}`}
                className="group flex shrink-0 cursor-zoom-in flex-col rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-4 focus-visible:ring-offset-background"
                style={{ width: w }}
              >
                {rows(
                  <span className="block truncate text-xs text-muted-foreground">{s.current?.title}</span>,
                  <ScreenFace step={s} side="current" w={w} drafting={drafting} lifts />,
                  <ScreenFace step={s} side="proposed" w={w} drafting={drafting} lifts dim />,
                  p && (
                    <span className="block pt-2 text-xs leading-[18px]">
                      <span className="block truncate">{p.change ? <><ChangeWord p={p} /><span className="text-muted-foreground">: {p.title}</span></> : <span className="text-muted-foreground">{p.title}</span>}</span>
                      {isTouched(p) && p.caption && <span className="block truncate text-muted-foreground" title={p.caption}>{p.caption}</span>}
                    </span>
                  ),
                )}
              </button>
            </div>
          );
        })}
        {!scrolls && <div aria-hidden className="shrink-0" style={{ width: OVERVIEW.gutter }} />}
      </div>
    </div>
  );
}

/** What the large view says beside the proposed screen: the change, the caption, and the tap that leads here. */
function StepNote({ step }: { step: Step }) {
  const p = step.proposed;
  return (
    <div className="space-y-2 text-sm">
      {p?.change && <p className="text-[15px]"><ChangeWord p={p} />{p.change === "new" && <span className="text-muted-foreground"> screen</span>}</p>}
      {p?.caption ? <p className="leading-relaxed">{p.caption}</p> : <p className="text-muted-foreground">{!p ? "This step isn't drawn yet." : p.change === "same" ? "No change on this step." : "No note on this change."}</p>}
      {step.tapProposed && <p className="text-muted-foreground">Reached by tapping <span className="text-foreground">{step.tapProposed}</span></p>}
    </div>
  );
}

/** The flow in miniature under the large view: where this step sits, and a way to jump to any other. */
function StepStrip({ steps, k, onPick }: { steps: Step[]; k: number; onPick: (k: number) => void }) {
  const w = 24;
  return (
    <nav aria-label="Steps" className="flex items-center gap-2">
      {steps.map((s, j) => {
        const side = s.proposed ?? s.current;
        return (
          <button
            key={s.key} type="button" onClick={() => onPick(j)} aria-label={`Step ${j + 1}: ${side?.title ?? "not drawn"}`} aria-current={j === k ? "step" : undefined}
            className={`press shrink-0 rounded-md outline-none transition-[opacity,box-shadow] focus-visible:ring-2 focus-visible:ring-ring/60 ${j === k ? "ring-2 ring-[var(--brand)] ring-offset-2 ring-offset-background" : "opacity-55 hover:opacity-100"}`}
          >
            {side?.frame
              ? <FrameThumb frame={side.frame} width={w} label="" className="rounded-md border border-border" />
              // eslint-disable-next-line @next/next/no-img-element
              : side?.url ? <img src={side.url} alt="" className="rounded-md border border-border object-cover object-top" style={{ width: w, height: tall(w) }} />
              : <span className="block rounded-md border border-dashed border-foreground/25" style={{ width: w, height: tall(w) }} />}
          </button>
        );
      })}
    </nav>
  );
}

/** One step large: today's screen beside the proposed one, the changes ringed, with a note and the steps around it. */
function StepDetail({ steps, k, setK, size, drafting }: { steps: Step[]; k: number; setK: (k: number) => void; size: { w: number; h: number }; drafting: boolean }) {
  const { w, wide } = fitDetail({ bodyW: size.w, bodyH: size.h });
  const s = steps[k];
  const arrow = (dir: -1 | 1) => {
    const to = k + dir;
    const Icon = dir < 0 ? ChevronLeft : ChevronRight;
    return (
      <button type="button" aria-label={dir < 0 ? "Previous step" : "Next step"} disabled={to < 0 || to >= steps.length} onClick={() => setK(to)} className="btn-paper grid size-11 shrink-0 place-items-center outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-0">
        <Icon className="size-5" />
      </button>
    );
  };
  const face = (side: "current" | "proposed") => {
    const t = s[side]?.title;
    return (
      <figure className="shrink-0">
        <figcaption className="truncate text-xs" style={{ height: DETAIL.label, width: w }}>
          <span className={side === "proposed" ? "font-semibold text-[var(--brand)]" : "font-semibold"}>{side === "current" ? "Current" : "Proposed"}</span>
          {t && <span className="text-muted-foreground">: {t}</span>}
        </figcaption>
        <ScreenFace step={s} side={side} w={w} drafting={drafting} />
      </figure>
    );
  };
  return (
    <div className="flex min-h-full flex-col" style={{ padding: wide ? `${DETAIL.padY}px ${DETAIL.padX}px` : `${DETAIL.padY}px ${DETAIL.narrowPadX}px` }}>
      {wide ? (
        // Equal sides keep the pair in the exact centre: an arrow on the left, the note and an arrow on the right.
        <div className="grid flex-1 grid-cols-[1fr_auto_1fr] items-center">
          <div className="justify-self-start">{arrow(-1)}</div>
          <div key={s.key} className="rise-in flex items-start" style={{ gap: DETAIL.pair }}>{face("current")}{face("proposed")}</div>
          <div className="flex justify-between gap-4 self-stretch" style={{ paddingLeft: DETAIL.pair }}>
            <div key={s.key} className="rise-in self-center" style={{ width: DETAIL.note - DETAIL.pair - 16 }}><StepNote step={s} /></div>
            <div className="self-center">{arrow(1)}</div>
          </div>
        </div>
      ) : (
        <>
          <div key={s.key} className="rise-in m-auto flex items-start" style={{ gap: DETAIL.narrowPair }}>{face("current")}{face("proposed")}</div>
          <div key={`note-${s.key}`} className="rise-in mx-auto mt-4 w-full max-w-sm"><StepNote step={s} /></div>
        </>
      )}
      <div className="flex items-center justify-center gap-3" style={{ height: DETAIL.strip }}>
        {!wide && arrow(-1)}
        <StepStrip steps={steps} k={k} onPick={setK} />
        {!wide && arrow(1)}
      </div>
    </div>
  );
}

/** The step open in the large view, held by index and screen so it survives the full flow replacing the mock-up's shots. */
type OpenStep = { k: number; id: string } | null;
const stepId = (s: Step) => s.proposed?.frame_id ?? s.current?.frame_id ?? s.key;

/**
 * The full flow, in a pop-up over the page: today's flow on top and the proposed one below, step by step, drawn from
 * the Marver canvas, centred and sized to fit. Clicking a step opens it large, beside today's screen. Until a full flow
 * exists it shows the mock-up's own `shots`, with a line while one is being started (`busy`) and the `error` if
 * starting it failed. `openAt` (a screen's frame id) opens straight onto that screen's step.
 */
export function FlowDialog({ open, onOpenChange, flow, onRetry, busy, title, shots, changes, openAt = null, error = null }: {
  open: boolean; onOpenChange: (open: boolean) => void; flow: FlowView | null; onRetry: () => void; busy: boolean;
  title: string; shots?: Shots; changes?: Map<string, string | null>; openAt?: string | null; error?: string | null;
}) {
  const steps = flow ? stepsFromFlow(flow.columns) : shots ? stepsFromShots(shots, changes) : [];
  const { measure, el: bodyEl, size } = useBodySize();
  const drafting = flow?.state === "drafting" || (!flow && busy);

  // Each time the pop-up opens, start on the screen it was opened from, or on the whole flow.
  const [view, setView] = useState<OpenStep>(null);
  const [seen, setSeen] = useState<{ open: boolean; at: string | null }>({ open: false, at: null });
  if (seen.open !== open || seen.at !== openAt) {
    setSeen({ open, at: openAt });
    const k = open ? stepIndex(steps, openAt) : null;
    setView(k === null ? null : { k, id: stepId(steps[k]) });
  }
  const at = !view ? null : steps[view.k] && stepId(steps[view.k]) === view.id ? view.k : stepIndex(steps, view.id);
  const show = (k: number | null) => setView(k === null ? null : { k, id: stepId(steps[k]) });

  // Focus follows the view: the back button in the large view, the step's column back on the whole flow.
  const back = useRef<HTMLButtonElement>(null);
  const lastStep = useRef<number | null>(null);
  useEffect(() => {
    const was = lastStep.current;
    lastStep.current = at;
    if (at !== null && was === null) back.current?.focus({ preventScroll: true });
    if (at === null && was !== null) bodyEl?.querySelector<HTMLElement>(`[data-step="${was}"]`)?.focus();
  }, [at, bodyEl]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next, details) => {
        // Esc steps back out of a large step before it closes the pop-up.
        if (!next && at !== null && details.reason === "escape-key") { details.cancel(); show(null); return; }
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-[rgb(46_43_43/0.28)] backdrop-blur-[3px] transition-[opacity,backdrop-filter] duration-300 ease-smooth data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none" />
        <Dialog.Popup
          data-slot="flow-dialog"
          onKeyDown={(e) => {
            if (at === null || e.altKey || e.metaKey || e.ctrlKey) return;
            if (e.key === "ArrowLeft" && at > 0) { e.preventDefault(); show(at - 1); }
            if (e.key === "ArrowRight" && at < steps.length - 1) { e.preventDefault(); show(at + 1); }
          }}
          className="fixed inset-2 z-50 flex flex-col overflow-hidden rounded-2xl bg-background shadow-pop outline-none transition-[opacity,scale,translate] duration-300 ease-smooth data-ending-style:translate-y-2 data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:scale-[0.97] data-starting-style:opacity-0 motion-reduce:transition-none sm:inset-5"
        >
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-6 py-4">
            <div className="flex min-w-0 items-start gap-3">
              {at !== null && (
                <button ref={back} type="button" onClick={() => show(null)} className="press mt-0.5 inline-flex h-9 shrink-0 items-center gap-1 rounded-full pr-3 pl-2 text-sm text-muted-foreground outline-none hover:bg-card hover:text-foreground hover:shadow-paper focus-visible:ring-2 focus-visible:ring-ring/60">
                  <ChevronLeft className="size-4" />Full flow
                </button>
              )}
              <div className="min-w-0 space-y-1">
                <Dialog.Title className="font-heading text-2xl font-semibold leading-tight">{flow ? `${flow.title}, full flow` : `${title}, before and after`}</Dialog.Title>
                <Dialog.Description className="text-sm text-muted-foreground">
                  {at !== null
                    ? <>Step {at + 1} of {steps.length}. Current on the left, proposed on the right.</>
                    : <>{!flow ? <>The mock-up&apos;s screens. </> : flow.board ? <>From the Marver board <code className="text-foreground/80">{flow.board}</code>. </> : <>From this issue&apos;s screens. </>}
                      Today&apos;s flow on top, the proposed one below.{flow?.summary ? ` ${flow.summary}.` : ""}</>}
                </Dialog.Description>
                {drafting && (
                  <p aria-live="polite" className="flex items-center gap-2 pt-0.5 text-sm text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin text-[var(--stage-drafting)]" />
                    {flow?.columns.some((c) => c.proposed) ? "Drawing the changed screens in Marver. This updates on its own." : "Planning the proposed flow from the Marver board. This updates on its own."}
                  </p>
                )}
                {flow?.state === "failed" && (
                  <div role="alert" className="flex flex-wrap items-center gap-3 pt-1 text-sm">
                    <span className="flex items-center gap-2"><TriangleAlert className="size-4 text-[var(--stage-failed)]" />The full flow didn&apos;t finish: {flow.error}</span>
                    <button type="button" onClick={onRetry} disabled={busy} className="btn-ink sheen inline-flex h-8 items-center gap-2 px-3 text-sm disabled:opacity-60">{busy && <Loader2 className="size-4 animate-spin" />}Try again</button>
                  </div>
                )}
                {!flow && error && <p role="alert" className="flex items-center gap-2 pt-0.5 text-sm"><TriangleAlert className="size-4 text-[var(--stage-failed)]" />The full flow didn&apos;t start: {error}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {flow?.canvasUrl && <a href={flow.canvasUrl} target="_blank" rel="noreferrer" className="press inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm text-muted-foreground hover:bg-card hover:text-foreground hover:shadow-paper"><ExternalLink className="size-3.5" />Open in Marver</a>}
              <Dialog.Close aria-label="Close" className="press grid size-9 place-items-center rounded-full text-muted-foreground outline-none hover:bg-card hover:text-foreground hover:shadow-paper focus-visible:ring-2 focus-visible:ring-ring/60"><X className="size-4" /></Dialog.Close>
            </div>
          </header>
          <div ref={measure} className="relative min-h-0 flex-1 overflow-auto">
            {size.h > 0 && steps.length > 0 && (at !== null
              ? <StepDetail steps={steps} k={at} setK={show} size={size} drafting={drafting} />
              : <FlowOverview steps={steps} size={size} drafting={drafting} linked={!!flow} onOpen={show} />)}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
