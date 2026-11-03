import { urgencyWord } from "@/lib/analysis";

/**
 * Urgency as a colour scale: 1 is green, 5 yellow, 10 red, and every step between blends along the way. The hue
 * moves; text stays a deep shade of the same hue on a pale fill, so it reads at every step.
 */
export function urgencyHue(score: number): number {
  const s = Math.min(10, Math.max(1, score));
  return s <= 5 ? 140 + ((48 - 140) * (s - 1)) / 4 : 48 + ((4 - 48) * (s - 5)) / 5;
}

/** "9/10" in a pill tinted by how urgent it is (the number Why it matters shows as "9 of 10"). */
export function UrgencyBadge({ score, className = "" }: { score: number; className?: string }) {
  const h = Math.round(urgencyHue(score));
  return (
    <span
      title={`Urgency ${score} of 10: ${urgencyWord(score)}`}
      className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-full pr-2 pl-1.5 text-xs font-semibold tabular-nums ${className}`}
      style={{ background: `hsl(${h} 90% 93%)`, color: `hsl(${h} 80% 25%)`, boxShadow: `inset 0 0 0 1px hsl(${h} 70% 42% / 0.3)` }}
    >
      <span aria-hidden className="size-2 rounded-full" style={{ background: `hsl(${h} 82% 45%)`, boxShadow: `0 0 0 2px hsl(${h} 82% 45% / 0.18)` }} />
      {score}<span className="font-medium opacity-60">/10</span>
    </span>
  );
}
