import Link from "next/link";
import { buildSegments, type HUnit } from "@/lib/highlights";
export function Highlights({ raw, units }: { raw: string; units: HUnit[] }) {
  return (
    <div className="surface whitespace-pre-wrap p-5 text-sm leading-relaxed">
      {buildSegments(raw, units).map((s, i) => {
        if (!s.unit) return <span key={i}>{s.text}</span>;
        const u = s.unit; const filtered = ["irrelevant", "question"].includes(u.type);
        const style = filtered ? undefined : { textDecorationColor: u.type === "praise" ? "var(--tone-positive)" : `var(--type-${u.type})` };
        const cls = filtered ? "text-muted-foreground/60" : "underline decoration-2 underline-offset-4";
        // Each piece links to its reading on the same page (PieceReading).
        return <Link key={i} id={`u-${u.id}`} href={`#piece-${u.id}`} className={cls} style={style} title={u.filtered_reason ?? (u.type === "praise" ? "What's working" : undefined)}>{s.text}</Link>;
      })}
    </div>
  );
}
