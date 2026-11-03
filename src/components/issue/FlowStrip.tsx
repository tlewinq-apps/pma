/** A row of phone frames in flow order: rendered shots when we have them, otherwise labelled placeholders. */
export function FlowStrip({ label, frames, empty = "Not drafted yet", accent }: { label: string; frames: { frame_id: string; title?: string | null; url?: string | null; step?: string }[]; empty?: string; accent?: string }) {
  return (
    <figure className="min-w-0 space-y-2">
      <figcaption className="flex items-center gap-2 text-xs text-muted-foreground">
        {accent && <span aria-hidden className="size-1.5 rounded-full" style={{ background: accent }} />}{label}
      </figcaption>
      <div className="no-scrollbar flex gap-2.5 overflow-x-auto pb-1">
        {frames.length === 0 && <div className="grid aspect-[9/16] w-40 place-items-center rounded-xl border border-dashed border-foreground/20 p-3 text-center text-xs text-muted-foreground">{empty}</div>}
        {frames.map((f, i) => (
          <div key={`${f.frame_id}-${i}`} className="w-40 shrink-0">
            {f.url ? // eslint-disable-next-line @next/next/no-img-element
              <img src={f.url} alt={`${label}: ${f.title ?? f.frame_id}`} className="aspect-[9/16.8] w-full rounded-xl border border-border object-cover object-top" style={accent ? { borderColor: accent } : undefined} />
              : <div className="grid aspect-[9/16.8] w-full place-items-center rounded-xl border border-border bg-card p-3 text-center text-xs text-muted-foreground">{f.step ?? f.title ?? f.frame_id}</div>}
            <div className="mt-1.5 truncate text-[11px] text-muted-foreground">{i + 1}. {f.title ?? f.frame_id}</div>
          </div>
        ))}
      </div>
    </figure>
  );
}
