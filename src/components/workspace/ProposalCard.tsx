"use client";
import { useState } from "react";
import { Check, Loader2, Lock, Pencil, RotateCcw } from "lucide-react";
import type { IssueDetail } from "@/lib/queries/issueDetail";
import { EFFORT_LABEL, RISK_LABEL } from "@/components/triage/format";
import { provenanceLabel } from "@/lib/proposals";

type Solution = IssueDetail["solutions"][number];
type Props = {
  s: Solution; selected: boolean; me: string | null; drift: boolean; justSaved: boolean;
  lockReason: string | null; action: string | null; busy: boolean; disabled: boolean; feedforward: string | null;
  onSelect: () => void; onEdit: () => void; onRestore: () => void; onImplement: () => void;
  /** The drafted proposal carries its mock-up, under its own toggle. */
  mockup?: React.ReactNode;
};

const PROVENANCE_TONE = { ai: "text-muted-foreground", edited: "text-[var(--stage-drafting)]", pm: "text-[var(--stage-review)]" } as const;

/**
 * One proposal. Not selected, it's a one-line row (the summary is on hover). Selected, the details and the next action.
 * The drafted one carries its mock-up instead, so its details stay folded and the mock-up gets the room.
 */
export function ProposalCard({ s, selected, me, drift, justSaved, lockReason, action, busy, disabled, feedforward, onSelect, onEdit, onRestore, onImplement, mockup }: Props) {
  const p = provenanceLabel(s, me);
  const frames = s.target_frames.length;
  // Long write-ups are clamped so the page stays on one screen; "Show all" opens them.
  const [full, setFull] = useState(false);
  const long = s.summary.length > 150 || (s.tradeoffs?.length ?? 0) > 90;
  const open = selected && !mockup;
  return (
    <div className="py-3.5">
      <div className="flex items-start gap-3">
        <button type="button" role="radio" aria-checked={selected} onClick={onSelect} title={open ? undefined : s.summary} className="flex min-w-0 flex-1 items-start gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
          <span aria-hidden className={`mt-[7px] grid size-4 shrink-0 place-items-center rounded-full border ${selected ? "border-foreground" : "border-foreground/30"}`}>{selected && <span className="size-2 rounded-full bg-foreground" />}</span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="font-heading text-[19px] font-semibold leading-snug">{s.title}</span>
              {s.recommended && !mockup && <span className="text-xs text-muted-foreground">Recommended</span>}
              {p.kind !== "ai" && <span className={`text-xs ${PROVENANCE_TONE[p.kind]}`}>{p.label}</span>}
              {drift && <span className="text-xs text-[var(--stage-drafting)]">Changed since this mock-up</span>}
              {justSaved && <span role="status" className="inline-flex items-center gap-1 text-xs text-[var(--stage-ready)]"><Check className="size-3" />Saved</span>}
            </span>
            {open && <span className={`mt-0.5 text-[15px] leading-relaxed text-muted-foreground ${full ? "block" : "line-clamp-2"}`}>{s.summary}</span>}
          </span>
        </button>
        {lockReason ? (
          <span title={lockReason} className="mt-1 inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><Lock className="size-3" /><span className="hidden sm:inline">{lockReason === "Shipped" || lockReason === "Approved" ? lockReason : "Drafting"}</span></span>
        ) : (
          <button type="button" onClick={onEdit} aria-label={`Edit ${s.title}`} className="mt-0.5 inline-flex h-7 shrink-0 items-center gap-1.5 px-1.5 text-xs text-muted-foreground hover:text-foreground">
            <Pencil className="size-3" />Edit
          </button>
        )}
      </div>
      {!open && action && mockup && (
        <div className="mt-2 pl-7">
          <button type="button" data-tour="mock-it-up" onClick={onImplement} disabled={disabled} className="inline-flex h-10 items-center gap-2 btn-ink sheen px-4 text-sm font-medium disabled:opacity-60">{busy && <Loader2 className="size-4 animate-spin" />}{action}</button>
        </div>
      )}
      {open && (
        <div className="mt-2.5 space-y-3 pl-7">
          {s.tradeoffs && <p className={`text-sm leading-relaxed ${full ? "" : "line-clamp-1"}`}><span className="text-muted-foreground">The catch: </span>{s.tradeoffs}</p>}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
            {s.effort && <span>{EFFORT_LABEL[s.effort] ?? s.effort}</span>}
            {s.risk && <span>{RISK_LABEL[s.risk] ?? s.risk}</span>}
            {/* With no screens, a feedforward means it is drawn from the app's code instead (ProposalList). */}
            {(frames > 0 || !feedforward) && <span>{frames === 0 ? "No screens yet" : frames === 1 ? "1 screen" : `${frames} screens`}</span>}
            {frames > 0 && <span>{s.mode === "round" ? "New version of the flow" : "Variant beside the current screen"}</span>}
            {long && <button type="button" onClick={() => setFull((f) => !f)} className="underline-offset-2 hover:text-foreground hover:underline">{full ? "Show less" : "Show all"}</button>}
          </div>
          {p.kind === "edited" && s.has_original && !lockReason && (
            <button type="button" onClick={onRestore} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"><RotateCcw className="size-3" />Restore PMA&apos;s version</button>
          )}
          {action && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <button type="button" data-tour="mock-it-up" onClick={onImplement} disabled={disabled} className="inline-flex h-11 items-center gap-2 btn-ink sheen px-5 text-[15px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60">
                {busy && <Loader2 className="size-4 animate-spin" />}{action}
              </button>
              {feedforward && <p className="text-xs text-muted-foreground">{feedforward}</p>}
            </div>
          )}
        </div>
      )}
      {mockup && <div className="pl-7">{mockup}</div>}
    </div>
  );
}
