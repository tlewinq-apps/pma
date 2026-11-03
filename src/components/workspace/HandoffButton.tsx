"use client";
import { useState } from "react";
import { Check, ClipboardCopy, Download, Loader2 } from "lucide-react";
import { copyText } from "@/components/invite/CopyLink";

/**
 * Copy task for Claude Code: fetches the chosen proposal as a markdown task (api/issues/[id]/handoff) and copies it.
 * Download task beside it saves the same task: as a .zip with the mock-up's images and layout code when the proposal
 * has a mock-up (`zip`), else as a .md file. Either one is recorded as the hand-off (POST to the same route), so the
 * issue can say it is waiting for the pull request.
 */
export function HandoffButton({ issueId, solutionId, title, zip = false, compact = false, hint = true, onHandedOff }: {
  issueId: string; solutionId: string; title: string;
  /** The proposal has a finished mock-up: Download task is a .zip with today.png, proposed.png and the layout code. */
  zip?: boolean;
  /** Smaller, without the explanation line: for handing it off again from the build panel. */
  compact?: boolean;
  /** The line under the buttons on what the task holds; the build panel says it itself. */
  hint?: boolean;
  onHandedOff?: () => void;
}) {
  const [state, setState] = useState<"idle" | "busy" | "copied" | "refused" | "failed">("idle");
  const url = `/api/issues/${issueId}/handoff?solution=${encodeURIComponent(solutionId)}`;
  const record = (via: "copy" | "download") => {
    void fetch(`/api/issues/${issueId}/handoff`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ via, solution: solutionId }) })
      .then((r) => { if (r.ok) onHandedOff?.(); })
      .catch(() => {});
  };
  const copy = async () => {
    setState("busy");
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) { setState("failed"); return; }
      const ok = await copyText(await res.text());
      setState(ok ? "copied" : "refused");
      if (ok) { record("copy"); setTimeout(() => setState((s) => (s === "copied" ? "idle" : s)), 2200); }
    } catch {
      setState("failed");
    }
  };
  const linkClass = "inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline";
  return (
    <div className={compact || !hint ? "space-y-1" : "space-y-1.5 pt-3"}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" onClick={() => void copy()} disabled={state === "busy"} data-handoff={solutionId}
          className={compact ? `${linkClass} disabled:opacity-60` : "btn-paper inline-flex h-10 items-center gap-2 px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60"}>
          {state === "busy" ? <Loader2 aria-hidden className="size-4 animate-spin" /> : state === "copied" ? <Check aria-hidden className="size-4" /> : <ClipboardCopy aria-hidden className={compact ? "size-3.5" : "size-4"} />}
          {state === "copied" ? "Copied" : "Copy task for Claude Code"}
        </button>
        <a href={zip ? `${url}&format=zip` : `${url}&download=1`} download onClick={() => record("download")}
          title={zip ? "A .zip with task.md, today.png, proposed.png and the mock-up's layout code" : "The task as a .md file"} className={linkClass}>
          <Download aria-hidden className="size-3.5" />Download task
        </a>
      </div>
      {((!compact && hint) || state === "refused" || state === "failed") && (
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {state === "refused" ? "Your browser wouldn't copy it. Use Download task instead."
            : state === "failed" ? "Couldn't build the task. Try again."
            : zip ? <>Hands &ldquo;{title}&rdquo; to Claude Code: what people said, what PMA found, the files to start from and how to check it. Download task adds the mock-up images.</>
            : <>Hands &ldquo;{title}&rdquo; to Claude Code as a task: what people said, what PMA found, the files to start from and how to check it.</>}
        </p>
      )}
    </div>
  );
}
