import { ViewTransition } from "react";
import Link from "next/link";
import type { IssueCardData } from "@/lib/queries/issues";
import { stageLabel, stageOf } from "@/components/triage/views";
import { initials, timeAgo } from "@/components/triage/format";
import { appHref } from "@/lib/links";

export type ProjectRow = IssueCardData & { ownerName: string };

function Row({ p, selected, now, base }: { p: ProjectRow; selected: boolean; now: number; base: string }) {
  const stage = stageOf(p, now);
  return (
    <li>
      <Link
        href={appHref(base, `/work?p=${p.id}`)} scroll={false} transitionTypes={["project-switch"]} aria-current={selected ? "page" : undefined}
        className={`press relative isolate block rounded-xl py-2.5 pr-3 pl-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${selected ? "" : "hover:bg-card/70"}`}
      >
        {selected && (
          <ViewTransition name="project-pill" share="glide" default="none">
            <span aria-hidden className="absolute inset-0 -z-10 rounded-xl bg-card shadow-paper" />
          </ViewTransition>
        )}
        <span aria-hidden className="absolute inset-y-3 left-0 w-[3px] rounded-r-full" style={{ background: `var(--type-${p.type})` }} />
        <span className={`line-clamp-2 text-sm leading-snug ${selected ? "font-semibold text-foreground" : "text-foreground/90"}`}>{p.title}</span>
        <span className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[9px] font-semibold text-foreground ring-2 ring-card">{initials(p.owner?.email ?? p.ownerName)}</span>
          <span className="min-w-0 truncate">{p.ownerName}</span>
          <span className="ml-auto shrink-0">{stageLabel(stage, p.type)}</span>
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground/80">Updated {timeAgo(p.last_activity_at, now)}</span>
      </Link>
    </li>
  );
}

/** Owned issues: the ones in flight, then the shipped ones, each newest first. */
export function ProjectList({ ongoing, shipped, selectedId, now, base, demo = true }: { ongoing: ProjectRow[]; shipped: ProjectRow[]; selectedId: string | null; now: number; base: string; demo?: boolean }) {
  const group = (title: string, rows: ProjectRow[], empty: string) => (
    <section aria-label={title} className="space-y-1.5">
      <h2 className="flex items-baseline gap-2 px-1 font-heading text-lg font-semibold">{title}<span className="font-sans text-xs font-normal tabular-nums text-muted-foreground">{rows.length}</span></h2>
      {rows.length
        ? <ul className="space-y-1">{rows.map((p) => <Row key={p.id} p={p} selected={p.id === selectedId} now={now} base={base} />)}</ul>
        : <p className="px-1 text-xs text-muted-foreground">{empty}</p>}
    </section>
  );
  return (
    <nav aria-label="Projects" className="space-y-6">
      {group("Ongoing", ongoing, "Nothing in flight. Assign yourself on any issue to start a project.")}
      {/* A customer app's approved mock-up is only ready to build: it ships when its code pull request merges. */}
      {group("Shipped", shipped, demo ? "Nothing shipped yet. A project lands here once its mock-up is approved." : "Nothing shipped yet. A project lands here once its pull request merges.")}
    </nav>
  );
}
