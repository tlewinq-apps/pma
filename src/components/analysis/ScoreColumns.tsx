// The three scores of Why it matters side by side: urgency, stakeholders, fixability. The only place PMA shows a
// number, out of 10 and always with its word. `large` leads the issue panel with the reasons under each score;
// `compact` sits under an issue on the feedback page.
import type { Analysis, Score } from "@/lib/analysis";
import { cn } from "@/lib/utils";

const order = (a: Analysis): Score[] => [a.urgency, a.stakeholders, a.fixability];

function Numeral({ score, size }: { score: number; size: "large" | "compact" }) {
  return (
    <p className="flex items-baseline gap-1.5">
      <span className={cn("font-heading font-semibold leading-none tabular-nums tracking-[-0.03em]", size === "large" ? "text-[64px]" : "text-[34px]")}>{score}</span>
      <span className={cn("text-muted-foreground", size === "large" ? "text-[15px]" : "text-[13px]")}>of 10</span>
    </p>
  );
}

export function ScoreColumns({ a, size = "large", className }: { a: Analysis; size?: "large" | "compact"; className?: string }) {
  if (size === "compact") {
    return (
      <dl className={cn("grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-3", className)}>
        {order(a).map((s) => (
          <div key={s.key} className="min-w-0">
            <dt className="text-[13px] text-muted-foreground">{s.name}</dt>
            <dd className="mt-1 space-y-1"><Numeral score={s.score} size="compact" /><p className={cn("text-[14px] font-semibold leading-snug", s.tone)}>{s.word}</p></dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <div className={cn("surface grid grid-cols-1 overflow-hidden md:grid-cols-3", className)}>
      {order(a).map((s, k) => (
        <section key={s.key} aria-labelledby={`score-${s.key}`} className={cn("min-w-0 px-6 py-5", k > 0 && "border-t border-border md:border-t-0 md:border-l")}>
          <h3 id={`score-${s.key}`} className="text-[14px] font-semibold text-muted-foreground">{s.name}</h3>
          <div className="mt-3"><Numeral score={s.score} size="large" /></div>
          <p className={cn("mt-2 text-[16px] font-semibold leading-snug", s.tone ?? "text-foreground")}>{s.word}</p>
          <div className="mt-4 space-y-2.5 text-[14px] leading-relaxed text-foreground/85">
            {s.reasons.map((r) => <p key={r.lead}><span className="font-semibold text-foreground">{r.lead}.</span>{r.text && <> {r.text}</>}</p>)}
          </div>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-border pt-3 text-[13px]">
            {s.parts.map((p) => <div key={p.label} className="contents"><dt className="text-muted-foreground">{p.label}</dt><dd className="text-foreground">{p.value}</dd></div>)}
          </dl>
        </section>
      ))}
    </div>
  );
}
