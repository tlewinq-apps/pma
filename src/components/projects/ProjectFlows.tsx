"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Route } from "lucide-react";
import type { IssueDetail } from "@/lib/queries/issueDetail";
import { FlowDialog, FlowRows, mockupChanges, mockupShots } from "@/components/workspace/FlowDialog";

const THUMB_W = 56;
const SHOT_H = "h-[150px]";
const opens = "cursor-zoom-in text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60";

function Shot({ label, url, accent }: { label: string; url: string | null; accent?: boolean }) {
  return (
    <figure className="shrink-0 space-y-1">
      <figcaption className="text-xs font-semibold" style={{ color: accent ? "var(--brand)" : undefined }}>{label}</figcaption>
      {url
        // eslint-disable-next-line @next/next/no-img-element
        ? <span className="zoom-media sheen block rounded-lg border bg-card shadow-paper" style={{ borderColor: accent ? "var(--brand)" : "var(--border)" }}><img src={url} alt={label} className={`${SHOT_H} aspect-[390/844] object-cover object-top`} /></span>
        : <div className={`${SHOT_H} grid aspect-[390/844] place-items-center rounded-lg border border-dashed border-foreground/20 text-xs text-muted-foreground`}>None</div>}
    </figure>
  );
}

/**
 * The finished before and after: today's flow over the proposed one once Create full flow has drawn it, the mock-up's
 * one screen before that, and a line saying what comes first when there is neither. Either opens the full flow in a
 * pop-up on this page; with none drawn yet, opening the mock-up's screen starts drawing it.
 */
export function ProjectFlows({ d }: { d: IssueDetail }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [openAt, setOpenAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft = d.draft;
  const flow = draft?.flow ?? null;
  // The flow is drawn on the server: refresh until it lands, as the issue page does.
  useEffect(() => {
    if (flow?.state !== "drafting") return;
    const tick = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(tick);
  }, [flow?.state, router]);

  async function draw() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/issues/${d.id}/flow`, { method: "POST" });
      if (!res.ok) { setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "That didn't work. Try again."); return; }
      router.refresh();
    } catch {
      setError("Couldn't reach PMA. Check your connection and try again.");
    } finally { setBusy(false); }
  }
  // The server draws a flow from a ready mock-up that has a Marver frame; anything else opens on the mock-up's screens.
  // An approximate mock-up (drawn from code) has no Marver frame: its frames entry only says what changed.
  const canDraw = !!draft?.frames.some((f) => !!f.path) && draft.status === "ready";
  // The flow opens whole; the mock-up's screen opens straight onto its own step, large.
  const show = (at: string | null = null) => { setOpenAt(at); setOpen(true); if (!flow && canDraw && !busy) void draw(); };

  let body: React.ReactNode;
  if (flow?.state === "ready" && flow.columns.length) {
    body = (
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <button type="button" onClick={() => show()} title="See the full flow, before and after" className={`-m-1 max-w-full overflow-x-auto rounded-xl p-1 transition-[background-color] duration-300 hover:bg-foreground/[0.03] ${opens}`}>
          <FlowRows columns={flow.columns} w={THUMB_W} />
        </button>
        <div className="max-w-[16ch] space-y-1 pb-1 text-xs text-muted-foreground">
          {flow.summary && <p>{flow.summary}.</p>}
          <button type="button" onClick={() => show()} className="inline-flex items-center gap-1.5 text-sm text-foreground underline-offset-4 hover:underline"><Route className="size-3.5" />Open full flow</button>
        </div>
      </div>
    );
  } else if (draft && draft.after.length) {
    const after = draft.after[0];
    const before = draft.before.find((b) => b.frame_id === after.frame_id) ?? draft.before[0] ?? null;
    body = (
      <div className="flex flex-wrap items-end gap-4">
        <button type="button" onClick={() => show(after.frame_id)} title="See this screen large, before and after" className={`flex gap-4 ${opens}`}>
          <Shot label="Current" url={before?.url ?? null} />
          <Shot label="Proposed" url={after.url} accent />
        </button>
        <p className="max-w-[28ch] pb-1 text-xs text-muted-foreground">
          {flow?.state === "drafting" || busy ? <span className="flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" />Drawing the full flow.</span>
            : canDraw ? <>The mock-up&apos;s screen. Open it to draw the full flow, every step before and after.</>
            : <>The mock-up&apos;s screen. Open it to see it larger.</>}
        </p>
      </div>
    );
  } else {
    body = <p className="text-sm text-muted-foreground">{draft?.status === "dispatched" ? "The mock-up is being drawn. Before and after appear here when it lands." : "No mock-up yet. Before and after appear here once one is drawn."}</p>;
  }
  return (
    <section aria-labelledby="before-after" className="space-y-2">
      <h3 id="before-after" className="font-heading text-lg font-semibold">Before and after</h3>
      {body}
      {draft && <FlowDialog open={open} onOpenChange={setOpen} flow={flow} title={d.title} shots={mockupShots(d)} changes={mockupChanges(d)} openAt={openAt} busy={busy} error={error} onRetry={() => void draw()} />}
    </section>
  );
}
