"use client";
// Why it matters, the issue's full reading: a verdict, urgency / stakeholders / fixability out of 10 with their
// reasons, where it happens on its flow, how people feel and who raised it. Slides over the right of the issue page
// (?why=1), so the page itself still fits one screen.
import Link from "next/link";
import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { Analysis, Feeling } from "@/lib/analysis";
import type { IssueDetail } from "@/lib/queries/issueDetail";
import type { Placement } from "@/lib/queries/issueAnalysis";
import { quoteSpeaker, type DetailQuote } from "@/lib/queries/issueHelpers";
import { peopleLabelFor } from "@/lib/proposals";
import { audienceWords, EMOTION_LABEL, EMOTION_TONE, SENTIMENT_LABEL, matchLabel, type Emotion } from "@/components/triage/format";
import { ScoreColumns } from "./ScoreColumns";
import { FlowPlacement } from "./FlowPlacement";
import { useApp } from "@/components/app/AppContext";

const date = (at: string) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const SQUARE: Record<number, string> = { [-2]: "var(--tone-negative)", [-1]: "var(--tone-caution)", 0: "rgb(97 91 83 / 0.45)", 1: "rgb(42 112 70 / 0.6)", 2: "var(--tone-positive)" };
const MAX_SQUARES = 6;

function Block({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-4 border-t border-border pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><h3 className="font-heading text-[22px] font-semibold leading-tight">{title}</h3>{aside}</div>
      {children}
    </section>
  );
}

/** Each piece of feedback as a square in the sentiment it was read with, most negative on the left. */
function Spread({ f }: { f: Feeling }) {
  const summary = f.buckets.filter((b) => b.count).map((b) => `${b.count} ${b.label.toLowerCase()}`).join(", ");
  // As tall as the tallest stack, so one or two pieces don't float in empty space.
  const tall = Math.min(MAX_SQUARES, Math.max(1, ...f.buckets.map((b) => b.count)));
  return (
    <div role="img" aria-label={`Sentiment of each piece: ${summary}`} className="grid grid-cols-5">
      {f.buckets.map((b) => (
        <div key={b.value} className="flex flex-col">
          <div aria-hidden className="flex flex-col-reverse items-center gap-1 border-b border-foreground/25 pb-2" style={{ minHeight: tall * 16 + 24 }}>
            {Array.from({ length: Math.min(b.count, MAX_SQUARES) }, (_, k) => <span key={k} className="size-3" style={{ background: SQUARE[b.value] }} />)}
            {b.count > MAX_SQUARES && <span className="text-[11px] tabular-nums text-muted-foreground">{b.count}</span>}
          </div>
          <span aria-hidden className="px-0.5 pt-1.5 text-center text-[11px] leading-tight text-muted-foreground">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

/** People who raised it, with their role (in the app's words), how they reached us and how many pieces they gave. */
function people(quotes: DetailQuote[], audienceOne: Record<string, string>) {
  const byName = new Map<string, { name: string; role: string | null; where: Set<string>; pieces: number; last: string }>();
  for (const q of quotes) {
    const names = q.speakers.filter((s) => s.trim()).length ? q.speakers : [q.author ?? "Someone"];
    for (const n of names) {
      const key = n.trim().toLowerCase();
      const p = byName.get(key) ?? { name: n.trim(), role: q.audience ? audienceOne[q.audience] ?? null : null, where: new Set<string>(), pieces: 0, last: q.at };
      p.pieces += 1;
      if (q.channel) p.where.add(q.channel);
      if (q.at > p.last) p.last = q.at;
      byName.set(key, p);
    }
  }
  return [...byName.values()].sort((a, b) => b.pieces - a.pieces || b.last.localeCompare(a.last));
}

export function AnalysisPanel({ open, onOpenChange, d, a, placement }: { open: boolean; onOpenChange: (open: boolean) => void; d: IssueDetail; a: Analysis | null; placement: Placement | null }) {
  const { href } = useApp();
  const quotes = [...d.quotes].sort((x, y) => (x.sentiment ?? 0) - (y.sentiment ?? 0));
  const who = people(d.quotes, audienceWords(d.project.profile).one);
  const others = d.breakdown?.inputs?.reportedByOthers ?? 0;
  const top = [...d.flow].sort((x, y) => y.confidence - x.confidence)[0];
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-[rgb(46_43_43/0.22)] backdrop-blur-[2px] transition-[opacity,backdrop-filter] duration-300 ease-smooth data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none" />
        <Dialog.Popup
          data-slot="analysis-panel"
          className="fixed inset-y-2 right-2 z-50 flex w-[calc(100%-1rem)] max-w-[940px] flex-col overflow-hidden rounded-2xl bg-background shadow-pop outline-none transition-[opacity,translate] duration-[380ms] ease-smooth data-ending-style:translate-x-10 data-ending-style:opacity-0 data-starting-style:translate-x-10 data-starting-style:opacity-0 motion-reduce:transition-none"
        >
          <span aria-hidden className="h-1.5 shrink-0" style={{ background: `var(--type-${d.type})` }} />
          <header className="flex items-start justify-between gap-6 px-6 pt-5 sm:px-10">
            <div className="min-w-0">
              <Dialog.Title className="font-heading text-[22px] font-semibold leading-tight">Why it matters</Dialog.Title>
              <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{d.title}</p>
            </div>
            <Dialog.Close aria-label="Close" className="press -mr-2 grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-card hover:text-foreground hover:shadow-paper focus-visible:ring-2 focus-visible:ring-ring/60"><X className="size-4" /></Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 pt-5 pb-16 sm:px-10">
            {a ? (
              <div className="space-y-6">
                <Dialog.Description className="max-w-[46ch] font-heading text-[clamp(1.45rem,2.1vw,1.85rem)] leading-[1.22] tracking-[-0.01em]">{a.verdict}</Dialog.Description>
                <ScoreColumns a={a} />
              </div>
            ) : (
              <Dialog.Description className="max-w-[60ch] text-[15px] text-muted-foreground">Not rated yet. The scores appear once PMA has rated this issue against its feedback.</Dialog.Description>
            )}

            <Block title="Where it happens">
              {placement ? <FlowPlacement p={placement} evidence={top ? d.flow.find((f) => f.frame_id === top.frame_id)?.evidence ?? null : null} match={top ? matchLabel(top.confidence) : null} />
                : <p className="text-[14px] text-muted-foreground">Not matched to a screen yet.</p>}
            </Block>

            <div className="grid gap-x-12 gap-y-8 md:grid-cols-2">
              <Block title="How they feel" aside={a?.feeling && <span className={`text-[16px] font-semibold ${a.feeling.tone}`}>{a.feeling.word}</span>}>
                {a?.feeling ? (
                  <div className="space-y-5">
                    <p className="text-[14px] leading-relaxed text-foreground/85">{a.feeling.text}</p>
                    <Spread f={a.feeling} />
                    <ul className="space-y-4">
                      {quotes.map((q) => (
                        <li key={q.id} className="space-y-1">
                          <p className="flex flex-wrap gap-x-3 text-[13px]">
                            {q.emotion && <span className={`font-semibold ${EMOTION_TONE[q.emotion as Emotion] ?? ""}`}>{EMOTION_LABEL[q.emotion as Emotion] ?? capital(q.emotion)}</span>}
                            <span className="text-muted-foreground">{SENTIMENT_LABEL[Math.round(q.sentiment ?? 0)]}</span>
                          </p>
                          <blockquote className="font-heading text-[17px] leading-snug text-foreground/90">{q.quote}</blockquote>
                          <Link href={href(`/feedback/${q.source_id}#piece-${q.id}`)} className="block text-[12px] text-muted-foreground hover:text-foreground">{[quoteSpeaker(q) ?? q.author ?? "Someone", q.channel, date(q.at)].filter(Boolean).join(", ")}</Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : <p className="text-[14px] text-muted-foreground">No feedback read yet.</p>}
              </Block>

              <Block title="Who raised it" aside={<span className="text-[14px] text-muted-foreground">{peopleLabelFor(who.length, d.audiences, d.project.profile)}</span>}>
                <ul className="surface divide-y divide-border overflow-hidden">
                  {who.map((p) => (
                    <li key={p.name} className="grid grid-cols-[1fr_auto] gap-x-4 px-4 py-3">
                      <p className="min-w-0 text-[15px]"><span className="font-semibold">{p.name}</span>{p.role && <span className="text-muted-foreground">, {p.role}</span>}</p>
                      <p className="text-right text-[13px] tabular-nums text-muted-foreground">{p.pieces} {p.pieces === 1 ? "piece" : "pieces"}</p>
                      <p className="col-span-2 mt-0.5 text-[13px] text-muted-foreground">{[...p.where].join(", ") || "Added by hand"}, last {date(p.last)}</p>
                    </li>
                  ))}
                </ul>
                {others > 0 && <p className="text-[14px] text-muted-foreground">Plus {others} {others === 1 ? "other" : "others"} they mentioned, not named. Each counts as half a person.</p>}
              </Block>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
