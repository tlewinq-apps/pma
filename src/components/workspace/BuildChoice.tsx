"use client";
import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { CheckCircle2, Loader2, X } from "lucide-react";
import { Disclosure } from "@/components/ui/disclosure";
import { BUILD_MODES, BUILD_OPTION, BUILD_QUESTION, buildModeAvailable, prNeeds, prNeedsWhy, type BuildCaps, type BuildMode } from "@/lib/handoff/build";

const primary = "inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-[15px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60";

/**
 * "How should this be built?", asked in a pop-up when a customer approves an approximate mock-up, so the issue page keeps
 * to one screen. Three ways, each with what it means. The two pull-request ways (Build it) can be picked once the
 * company's PMA GitHub App installation can write (`caps`); until then they say what's missing, and why sits behind a
 * toggle. "Add to an existing branch" asks for the branch. Owners and admins can keep their pick as the app's default
 * (Slack's Approve button uses it too).
 */
export function BuildChoice({ open, saved, savedBranch = null, caps, canSaveDefault, busy, error, onConfirm, onCancel }: {
  open: boolean;
  /** The app's saved default, if any, and its branch. */
  saved: BuildMode | null; savedBranch?: string | null;
  caps: BuildCaps;
  canSaveDefault: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: (mode: BuildMode, saveDefault: boolean, branch: string | null) => void;
  onCancel: () => void;
}) {
  const first = saved && buildModeAvailable(saved, caps) ? saved : "claude_code";
  const [mode, setMode] = useState<BuildMode>(first);
  const [branch, setBranch] = useState(savedBranch ?? "");
  const [keep, setKeep] = useState(false);
  const isDefault = saved === mode && (mode !== "branch" || (savedBranch ?? "") === branch.trim());
  const ready = buildModeAvailable(mode, caps) && (mode !== "branch" || !!branch.trim());
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-[rgb(46_43_43/0.28)] backdrop-blur-[3px] transition-[opacity,backdrop-filter] duration-300 ease-smooth data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none" />
        <Dialog.Popup
          data-slot="build-choice"
          className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-2xl bg-background p-6 shadow-pop outline-none transition-[opacity,scale] duration-300 ease-smooth data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0 motion-reduce:transition-none"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <Dialog.Title className="font-heading text-2xl font-semibold leading-tight">{BUILD_QUESTION}</Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">Approving says this is the change to build. It ships nothing and tells nobody yet: it ships when its pull request merges.</Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close" disabled={busy} className="press grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-card hover:text-foreground hover:shadow-paper focus-visible:ring-2 focus-visible:ring-ring/60"><X className="size-4" /></Dialog.Close>
          </div>
          <div role="radiogroup" aria-label={BUILD_QUESTION} className="grid gap-1.5">
            {BUILD_MODES.map((m) => {
              const on = buildModeAvailable(m, caps);
              const picked = mode === m;
              return (
                <label key={m} data-build-option={m}
                  className={`flex min-w-0 items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-[border-color,box-shadow] duration-200 ${on ? "cursor-pointer hover:border-foreground/40" : "cursor-not-allowed bg-foreground/[0.02]"} ${picked ? "border-foreground shadow-paper" : "border-border"}`}>
                  <input type="radio" name="build-mode" value={m} checked={picked} disabled={!on || busy} onChange={() => setMode(m)}
                    className="mt-0.5 size-4 shrink-0 accent-[var(--foreground)]" />
                  <span className="min-w-0 space-y-0.5">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className={`font-medium ${on ? "" : "text-muted-foreground"}`}>{BUILD_OPTION[m].label}</span>
                      {!on && <span className="text-xs text-muted-foreground">{prNeeds(caps)}</span>}
                      {on && saved === m && <span className="text-xs text-muted-foreground">This app&apos;s default</span>}
                    </span>
                    <span className={`block leading-snug ${on ? "text-foreground/80" : "text-xs text-muted-foreground"}`}>{BUILD_OPTION[m].line}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {mode === "branch" && (
            <div className="space-y-1">
              <label htmlFor="build-branch" className="text-sm font-medium">Branch to add it to</label>
              <input id="build-branch" value={branch} onChange={(e) => setBranch(e.target.value)} disabled={busy} required autoComplete="off" spellCheck={false}
                placeholder="feature/checkout-fix" className="field h-9 w-full px-2.5 font-mono text-sm outline-none" />
              <p className="text-xs text-muted-foreground">PMA commits on top of it and never forces: if someone pushes meanwhile, it stops and says so.</p>
            </div>
          )}
          {!caps.githubWrite && (
            <Disclosure label="Why can't PMA open the pull request?" buttonClassName="text-xs" panelClassName="pt-1.5 text-xs text-muted-foreground">
              {prNeedsWhy(caps)}
            </Disclosure>
          )}
          {canSaveDefault && !isDefault && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} disabled={busy} className="size-4 accent-[var(--foreground)]" />
              Make this the default for this app
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => onConfirm(mode, keep && !isDefault, mode === "branch" ? branch.trim() : null)} disabled={busy || !ready}
              className={`${primary} sheen press bg-[var(--stage-ready)] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_6px_14px_-6px_rgb(42_112_70/0.6)] hover:brightness-110`}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              {mode === "claude_code" ? "Approve and hand off" : "Approve and build"}
            </button>
            <button type="button" onClick={onCancel} disabled={busy} className="h-11 px-3 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
          {error && <p role="alert" className="text-sm text-[var(--stage-failed)]">{error}</p>}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
