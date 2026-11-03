import Link from "next/link";
import { AudioLines, ClipboardPaste, Code, FileText, Hash, MessageSquare, Inbox, type LucideIcon } from "lucide-react";
import { KIND_LABEL, STATUS_GROUPS, filterSources, sourceKind, statusGroup, summarizeSource, type SourceKind, type UnitOutcome } from "@/lib/sources/summary";
import { RetryButton } from "./RetryButton";
import { RefreshWhileWorking } from "./RefreshWhileWorking";
import { appHref } from "@/lib/links";

export type ReceivedRow = {
  id: string; raw_text: string; author: string | null; channel: string | null; kind: string; status: string;
  occurred_at: string; demo: boolean; error: string | null; metadata: { filename?: string } | null;
};
export type Outcomes = { units: Map<string, UnitOutcome[]>; titles: Map<string, string>; created: Map<string, Set<string>> };

const ICON: Record<SourceKind, LucideIcon> = { recording: AudioLines, document: FileText, pasted: ClipboardPaste, slack: Hash, widget: MessageSquare, api: Code, other: Inbox };

function filterHref(base: string, f: { status?: string; kind?: string }) {
  const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  return appHref(base, q ? `/feedback?${q}` : "/feedback");
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return <Link href={href} scroll={false} aria-current={active ? "true" : undefined} className={`press rounded-full px-2.5 py-1 ${active ? "bg-card font-semibold text-foreground shadow-paper" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"}`}>{children}</Link>;
}

/** Everything that came in, newest first, each with what it became. */
export function ReceivedList({ rows, outcomes, filter, base }: { rows: ReceivedRow[]; outcomes: Outcomes; filter: { status?: string; kind?: string }; base: string }) {
  const shown = filterSources(rows, filter);
  const kinds = [...new Set(rows.map(sourceKind))];
  const count = (status?: string) => filterSources(rows, { status, kind: filter.kind }).length;
  return (
    <section className="space-y-3">
      <RefreshWhileWorking active={rows.some((r) => statusGroup(r.status) === "working")} />
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Received</h2>
        <nav aria-label="Filter by status" className="flex flex-wrap gap-1 text-sm">
          <Chip href={filterHref(base, { kind: filter.kind })} active={!filter.status}>All {count()}</Chip>
          {STATUS_GROUPS.map((g) => <Chip key={g.key} href={filterHref(base, { status: g.key, kind: filter.kind })} active={filter.status === g.key}>{g.label} {count(g.key)}</Chip>)}
        </nav>
      </div>
      {kinds.length > 1 && (
        <nav aria-label="Filter by kind" className="flex flex-wrap gap-1 text-xs">
          <Chip href={filterHref(base, { status: filter.status })} active={!filter.kind}>Every kind</Chip>
          {kinds.map((k) => <Chip key={k} href={filterHref(base, { status: filter.status, kind: k })} active={filter.kind === k}>{KIND_LABEL[k]}</Chip>)}
        </nav>
      )}
      {shown.length === 0 ? (
        <p className="surface p-4 text-sm text-muted-foreground">{rows.length ? "Nothing matches these filters." : "Nothing yet. Add feedback above, or connect Slack and the widget in Settings."}</p>
      ) : (
        <ul className="surface divide-y overflow-hidden">{shown.map((r) => {
          const kind = sourceKind(r);
          const Icon = ICON[kind];
          const summary = summarizeSource({ status: r.status, kind: r.kind, rawTextEmpty: !r.raw_text.trim(), error: r.error }, outcomes.units.get(r.id) ?? [], outcomes.titles, outcomes.created.get(r.id) ?? new Set());
          const group = statusGroup(r.status);
          const name = r.metadata?.filename ?? r.channel ?? KIND_LABEL[kind];
          return (
            <li key={r.id} className="flex items-start gap-3 p-3.5 text-sm transition-colors duration-200 hover:bg-muted/50">
              <Icon aria-label={KIND_LABEL[kind]} className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <Link href={appHref(base, `/feedback/${r.id}`)} className="min-w-0 flex-1">
                <p className="truncate"><span className="font-medium">{r.author ?? "Unknown"}</span><span className="text-muted-foreground"> · {name} · {new Date(r.occurred_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}{r.demo ? " · Sample" : ""}</span></p>
                <p className={`mt-0.5 ${group === "needs_you" ? "text-tone-negative" : group === "working" ? "text-tone-caution" : "text-foreground/80"}`}>{summary}</p>
                {r.raw_text.trim() && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{r.raw_text}</p>}
              </Link>
              {r.status === "failed" && <RetryButton id={r.id} />}
            </li>
          );
        })}</ul>
      )}
    </section>
  );
}
