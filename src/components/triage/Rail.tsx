"use client";
import { addTransitionType, startTransition, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Rows3, GalleryHorizontal } from "lucide-react";
import type { Rail as RailData } from "./views";
import { stageOf } from "./views";
import { IssueCard } from "./IssueCard";
import { URGENT_FROM } from "./views";
import type { ProductProfile } from "@/lib/product/profile";

/** One type's row. Slides sideways (snap, arrows, trackpad); Expand wraps it into a grid. Edges fade only where more cards hide. */
export function Rail({ rail, index, hrefFor, profile }: { rail: RailData; index: number; hrefFor: (id: string) => string; profile?: ProductProfile | null }) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const el = track.current;
    if (!el || expanded) return;
    const update = () => setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update); ro.observe(el);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, [expanded, rail.items.length]);
  const page = (dir: 1 | -1) => track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.85, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  // Expanding is a transition so each card glides from the row into the grid (and back).
  const toggle = () => startTransition(() => { addTransitionType("rail-expand"); setExpanded((e) => !e); });
  const ready = rail.items.filter((i) => stageOf(i) === "proposal_ready").length;
  // The Urgent rail sits in a warm band and its cards glow, so it reads before the type rails below.
  const hot = rail.type === "urgent";
  const mask = expanded ? undefined : `linear-gradient(to right, ${edges.start ? "#000" : "transparent"} 0, #000 28px, #000 calc(100% - 28px), ${edges.end ? "#000" : "transparent"} 100%)`;

  return (
    <section aria-labelledby={`rail-${rail.type}`} className={hot ? "ember-band -mx-4 space-y-2.5 px-4 pt-3.5 pb-1" : "space-y-2.5"}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={`rail-${rail.type}`} className="flex items-baseline gap-2.5 whitespace-nowrap text-lg font-semibold">
          <span aria-hidden className="h-4 w-[3px] self-center rounded-full" style={{ background: hot ? "linear-gradient(var(--brand), var(--brand-strong))" : `var(--type-${rail.type})` }} />
          <span className={hot ? "text-[var(--brand-strong)]" : undefined}>{rail.label}</span>
          <span className="font-sans text-sm font-normal tabular-nums tracking-normal text-muted-foreground">{rail.items.length}</span>
          {hot
            ? <span className="hidden font-sans text-xs font-normal tracking-normal text-muted-foreground sm:inline">Urgency {URGENT_FROM} and up, most urgent first</span>
            : ready > 0 && <span className="hidden font-sans text-xs font-normal tracking-normal text-muted-foreground sm:inline">{ready} ready to mock up</span>}
        </h2>
        {rail.items.length > 0 && (
          <div className="flex items-center gap-1 text-muted-foreground">
            {!expanded && <>
              <button type="button" aria-label={`Scroll ${rail.label} left`} disabled={edges.start} onClick={() => page(-1)} className="press grid size-7 place-items-center rounded-full hover:bg-card hover:text-foreground hover:shadow-paper disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:shadow-none"><ChevronLeft className="size-4" /></button>
              <button type="button" aria-label={`Scroll ${rail.label} right`} disabled={edges.end} onClick={() => page(1)} className="press grid size-7 place-items-center rounded-full hover:bg-card hover:text-foreground hover:shadow-paper disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:shadow-none"><ChevronRight className="size-4" /></button>
            </>}
            <button type="button" aria-pressed={expanded} onClick={toggle} className="press ml-1 flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs hover:bg-card hover:text-foreground hover:shadow-paper">
              {expanded ? <GalleryHorizontal className="size-3.5" /> : <Rows3 className="size-3.5" />}<span className="sr-only sm:not-sr-only">{expanded ? "Collapse" : "Expand"}</span>
            </button>
          </div>
        )}
      </div>
      {rail.items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-foreground/15 px-4 py-3 text-xs text-muted-foreground">No open {rail.label.toLowerCase()}</p>
      ) : (
        <div
          ref={track}
          style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
          className={expanded ? "grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 pt-1" : "no-scrollbar -mx-3 -mt-2 -mb-4 flex snap-x snap-mandatory scroll-px-3 gap-4 overflow-x-auto px-3 pt-3 pb-6"}
        >
          {rail.items.map((i, pos) => <IssueCard key={i.id} issue={i} href={hrefFor(i.id)} rail={index} pos={pos} wide={expanded} hot={hot} profile={profile} />)}
        </div>
      )}
    </section>
  );
}
