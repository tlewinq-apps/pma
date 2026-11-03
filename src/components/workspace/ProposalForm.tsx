"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Loader2 } from "lucide-react";
import { checkOf, writePlaceholder } from "@/lib/diagnosis/checks";

type Props = {
  mode: "edit" | "create"; type: string; initial: string;
  /** The demo app's examples are about Celeste; any other app gets examples that fit any product. */
  demo: boolean;
  /** The screen a new proposal is mocked up on, for the hint under the box. */
  screen: string | null;
  recap?: { problem: string; found: string | null };
  onSave: (text: string) => Promise<string | null>; onCancel: () => void; onDirtyChange: (dirty: boolean) => void;
  onRemove?: () => Promise<string | null>; notice?: string | null;
};

const field = "field w-full px-3 py-2 text-[15px] outline-none placeholder:text-muted-foreground/70";

/**
 * Write your own (or edit) in one box: what you would do, in your own words. PMA names it and mocks up the
 * issue's own screen, so there is nothing else to fill in. The same form as Slack's.
 */
export function ProposalForm({ mode, type, initial, demo, screen, recap, onSave, onCancel, onDirtyChange, onRemove, notice }: Props) {
  const check = checkOf(type);
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(notice ?? null);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = box.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, []);

  const change = (next: string) => { setText(next); setError(null); onDirtyChange(next !== initial); };
  const save = async () => {
    if (saving) return;
    if (!text.trim()) { setError("Write what you would do"); return; }
    setSaving(true);
    const err = await onSave(text);
    setSaving(false);
    if (err) setError(err);
  };
  const remove = async () => {
    if (!onRemove) return;
    if (!confirmRemove) { setConfirmRemove(true); return; }
    const err = await onRemove();
    if (err) { setError(err); setConfirmRemove(false); }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); onCancel(); }
    else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} onKeyDown={onKey} className="space-y-3" aria-label={mode === "edit" ? "Edit proposal" : check.writeTitle}>
      {recap && (
        <div className="space-y-1.5 bg-muted px-3.5 py-3 text-sm">
          <p className="text-xs text-muted-foreground">You&apos;re solving</p>
          <p className="text-foreground/90">{recap.problem}</p>
          {recap.found && <p className="border-l-2 border-foreground/20 pl-2.5 text-muted-foreground"><span className="font-medium text-foreground/80">{check.result}:</span> {recap.found}</p>}
        </div>
      )}
      <div className="space-y-1.5">
        <label htmlFor="proposal-text" className="text-sm font-medium">{check.writeLabel}</label>
        <textarea
          id="proposal-text" ref={box} value={text} onChange={(e) => change(e.target.value)} maxLength={1000} rows={4}
          placeholder={writePlaceholder(type, demo)} aria-describedby="proposal-hint" className={`${field} resize-y leading-relaxed`}
        />
        <p id="proposal-hint" className="text-xs text-muted-foreground">
          {mode === "edit" ? "The name follows your words." : screen ? `PMA names it and mocks up ${screen}.` : "PMA names it for you."}
        </p>
      </div>
      {error && <p role="alert" className="text-sm text-[var(--stage-failed)]">{error}</p>}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {onRemove && <button type="button" onClick={remove} className={`h-9 px-2.5 text-sm ${confirmRemove ? "bg-[var(--stage-failed)]/15 text-[var(--stage-failed)]" : "text-muted-foreground hover:text-[var(--stage-failed)]"}`}>{confirmRemove ? "Remove for good" : "Remove"}</button>}
        <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">⌘↵ to save, Esc to cancel</span>
        <button type="button" onClick={onCancel} className="h-9 px-3 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
        <button type="submit" disabled={saving} className="inline-flex h-9 items-center gap-2 btn-ink sheen px-3.5 text-sm font-medium disabled:opacity-60">{saving && <Loader2 className="size-4 animate-spin" />}{mode === "edit" ? "Save" : "Add"}</button>
      </div>
    </form>
  );
}
