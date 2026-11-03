import Link from "next/link";
import { useApp } from "@/components/app/AppContext";
import type { IssueDetail } from "@/lib/queries/issueDetail";
import { quoteSpeaker, type DetailQuote } from "@/lib/queries/issueHelpers";
import { PanelRightOpen } from "lucide-react";
import { checkOf } from "@/lib/diagnosis/checks";
import { Disclosure } from "@/components/ui/disclosure";
import { cn } from "@/lib/utils";

export function Section({ title, children, aside, className }: { title: string; children: React.ReactNode; aside?: React.ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-baseline justify-between gap-3"><h2 className="font-heading text-[22px] font-semibold leading-tight">{title}</h2>{aside}</div>
      {children}
    </section>
  );
}

const date = (at: string) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const sentence = (s: string | null | undefined) => (s?.trim() ? s.trim().replace(/([^.!?])$/, "$1.") : "");

/** "Jordan Lee, Support call, Oct 15". */
const attribution = (q: DetailQuote) => [quoteSpeaker(q) ?? q.author ?? "Someone", q.channel, date(q.at)].filter(Boolean).join(", ");

/** The left half: what's wrong, the likely cause (or the diagnosed one), the way into Why it matters, and their words. */
export function EvidencePanel({ d, onWhy, children }: { d: IssueDetail; onWhy: () => void; children?: React.ReactNode }) {
  const { href } = useApp();
  const finding = d.diagnosis?.status === "done" ? d.diagnosis.finding : null;
  const suspected = d.breakdown?.suspected_cause?.trim() || null;
  const cause = finding?.headline ?? suspected ?? d.breakdown?.rationale?.scope ?? null;
  const check = checkOf(d.type);
  // Their strongest words lead; the rest wait behind a toggle.
  const [top, ...rest] = [...d.quotes].sort((a, b) => (a.sentiment ?? 0) - (b.sentiment ?? 0));

  return (
    <div data-tour="evidence" className="space-y-6">
      <Section title="What's wrong">
        <p className="max-w-[62ch] text-[17px] leading-relaxed text-foreground/90">{d.problem_statement}</p>
        {((d.type === "bug" && cause) || finding) && cause && (
          <div className="relative max-w-[62ch] rounded-xl bg-foreground/[0.035] py-2 pl-5 pr-4">
            <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r-full" style={{ background: finding ? "var(--stage-diagnose)" : "var(--input)" }} />
            <p className="text-[13px]">
              <span className="font-semibold">{finding ? check.result : "Likely cause"}</span>{" "}
              <span className={finding ? "text-[var(--stage-diagnose)]" : "text-muted-foreground"}>{finding ? (finding.source && !finding.source.read ? "from the feedback" : check.resultFrom) : "unconfirmed until diagnostics run"}</span>
            </p>
            <p className="mt-0.5 text-[15px] leading-relaxed">{sentence(cause)}</p>
          </div>
        )}
        <button type="button" onClick={onWhy} aria-haspopup="dialog" className="press -ml-3 flex items-center gap-1.5 rounded-full px-3 py-1 text-sm text-muted-foreground hover:bg-card hover:text-foreground hover:shadow-paper">
          Why it matters<PanelRightOpen aria-hidden className="size-3.5" />
        </button>
      </Section>

      {top && (
        <figure className="relative max-w-[60ch] pl-8">
          <span aria-hidden className="pointer-events-none absolute -top-4 left-0 select-none font-heading text-[68px] leading-none text-brand">&ldquo;</span>
          <blockquote title={top.quote} className="line-clamp-4 font-heading text-[clamp(1.25rem,1.55vw,1.55rem)] leading-[1.32] text-foreground">{top.quote}</blockquote>
          <figcaption className="mt-2.5 text-[13px] text-muted-foreground">
            <Link href={href(`/feedback/${top.source_id}#piece-${top.id}`)} className="link hover:text-foreground">{attribution(top)}</Link>
          </figcaption>
          {rest.length > 0 && (
            <Disclosure label={`${rest.length} more ${rest.length === 1 ? "quote" : "quotes"}`} className="mt-3">
              <ul className="max-h-56 space-y-4 overflow-y-auto pt-3 pr-2">
                {rest.map((q) => (
                  <li key={q.id}>
                    <blockquote className="font-heading text-[17px] leading-snug text-foreground/90">{q.quote}</blockquote>
                    <Link href={href(`/feedback/${q.source_id}#piece-${q.id}`)} className="mt-1 block text-xs text-muted-foreground hover:text-foreground">{attribution(q)}</Link>
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
        </figure>
      )}
      {children}
    </div>
  );
}
