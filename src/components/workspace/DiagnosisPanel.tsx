"use client";
import { useEffect, useId, useState } from "react";
import { Check, CircleCheck, Loader2, MapPin, Route, Stethoscope, Target, type LucideIcon } from "lucide-react";
import type { IssueDetail } from "@/lib/queries/issueDetail";
import { quoteSpeaker } from "@/lib/queries/issueHelpers";
import { codeRefUrl, diagnosisState, stepAt, type Diagnosis, type DiagnosisFinding } from "@/lib/diagnosis/model";
import { FEEDBACK_ONLY_AHEAD, PLANNED_CODE_STEPS, PLANNED_FEEDBACK_STEPS, checkOf, checkSteps, sourceLine } from "@/lib/diagnosis/checks";
import { flowLabel, timeAgo } from "@/components/triage/format";
import { DisclosureButton, DisclosurePanel } from "@/components/ui/disclosure";
import { Section } from "./EvidencePanel";
import { FollowupQuestions } from "./LoopPanels";
import { friendlyLlmError } from "@/lib/llm/errors";

const SIMULATED = "Simulated for the demo: the run reads no code and changes nothing. Its steps, timing and the proposals it hands to are the real flow.";
const ICON: Record<string, LucideIcon> = { bug: Stethoscope, new_feature: Target, add_on: MapPin, streamline: Route };

/** The screen this issue happens on, as the card and header name it: "Messages › Message thread". */
export const screenLabel = (d: IssueDetail) => (d.flow.length ? flowLabel(`${d.flow[0].frame_id.split("/")[0]} › ${d.flow.at(-1)!.title ?? d.flow.at(-1)!.frame_id}`) : null);
const firstReporter = (d: IssueDetail) => { const q = d.quotes[0]; return q ? quoteSpeaker(q)?.split(", ")[0] ?? q.author : null; };

/** Ticks once a second while a run is going, so its steps check off between page refreshes. */
function useClock(on: boolean, start: number) {
  const [now, setNow] = useState(start);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return Math.max(now, start);
}

/** What a run that read code (or the feedback only) did, the lines it cites and where it came from. The demo's
 *  simulated run has none of this. */
function RealRunDetail({ diag, f }: { diag: Diagnosis; f: DiagnosisFinding }) {
  const refs = f.code_refs ?? [];
  return (
    <>
      {refs.length > 0 && (
        <div className="min-w-0 sm:col-span-2">
          <h3 className="font-medium">Lines that matter</h3>
          <ul className="mt-1 space-y-1.5">
            {refs.map((r) => {
              const label = `${r.path}:${r.line}`;
              const url = codeRefUrl(f.source, r);
              return (
                <li key={label} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <code className="min-w-0 break-all font-mono text-[13px]">
                    {url ? <a href={url} target="_blank" rel="noreferrer" className="link">{label}</a> : label}
                  </code>
                  {r.note && <span className="text-foreground/85">{r.note}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {diag.steps.length > 0 && (
        <div className="min-w-0 sm:col-span-2">
          <h3 className="font-medium">What the run did</h3>
          <ol className="mt-1 list-decimal space-y-1 pl-4 text-foreground/85">{diag.steps.map((x, k) => <li key={`${k}:${x}`} className="break-words">{x}</li>)}</ol>
        </div>
      )}
    </>
  );
}

/** One line for a finished first step, with the run's detail behind a toggle at the end of that line. */
function FoundLine({ lead, children }: { lead: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="min-w-0 flex-1">
      <p className="flex flex-wrap items-baseline gap-x-3 text-[15px]">
        <span>{lead}</span>
        <DisclosureButton open={open} onToggle={() => setOpen((o) => !o)} controls={id}>What the run found</DisclosureButton>
      </p>
      <DisclosurePanel id={id} open={open}>{children}</DisclosurePanel>
    </div>
  );
}

/**
 * The issue's first step, at the top of the work surface: run it (diagnostics on a bug, scoping a feature, finding
 * where an add-on fits, mapping a streamline issue's steps), watch it, then what it found.
 */
/** Why the last run stopped, in plain words (older rows hold the API's raw error), and what to do. */
function failedLine(error: string | null): string {
  if (!error) return "The last run didn't finish. Run it again.";
  const why = friendlyLlmError(error);
  return `The last run didn't finish: ${why}${/\bagain\b|ask an admin/i.test(why) ? "" : " Run it again."}`;
}

export function DiagnosisPanel({ d, now, busy, error, onRun }: { d: IssueDetail; now: number; busy: boolean; error: string | null; onRun: () => void }) {
  const state = diagnosisState(d.type, d.diagnosis, now);
  const clock = useClock(state === "running", now);
  if (!state) return null;
  const diag = d.diagnosis;
  const check = checkOf(d.type);
  const Icon = ICON[d.type] ?? Stethoscope;

  if (state === "done" && diag?.finding) {
    const f = diag.finding;
    const simulated = diag.simulated !== false;
    return (
      // The headline itself leads the left column ("Cause, found by diagnostics"); this side keeps the run's detail.
      <section aria-label={check.step} className="flex items-start gap-3">
        <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-[var(--stage-diagnose)]" />
        <FoundLine lead={<><span className="font-semibold">{check.done.replace(/\.$/, "")}</span> <span className="text-muted-foreground">{d.type === "bug" ? (f.confidence === "confirmed" ? "and confirmed" : "with a likely cause") : ""}{d.type === "bug" ? ", " : ""}{diag.finished_at ? timeAgo(diag.finished_at, now) : "recently"}</span></>}>
            <div className="grid grid-cols-1 gap-4 pt-3 text-sm sm:grid-cols-2">
              {f.facts.map((x) => (
                <div key={x.label}>
                  <h3 className="font-medium">{x.label}</h3>
                  <p className="mt-1 text-foreground/85">{x.text}</p>
                </div>
              ))}
              {/* A real run has no logging column, and its evidence cites file paths: it gets the full width. */}
              <div className={!simulated && f.logging_added.length === 0 ? "sm:col-span-2" : undefined}>
                <h3 className="font-medium">Evidence</h3>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-foreground/85">{f.evidence.map((e) => <li key={e} className="[overflow-wrap:anywhere]">{e}</li>)}</ul>
              </div>
              {f.logging_added.length > 0 && (
                <div>
                  <h3 className="font-medium">Logging added</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-foreground/85">{f.logging_added.map((e) => <li key={e}>{e}</li>)}</ul>
                </div>
              )}
              {!simulated && <RealRunDetail diag={diag} f={f} />}
              <p className="break-words text-muted-foreground sm:col-span-2">
                {f.where ? `${f.where}. ` : ""}
                {simulated ? <span title={SIMULATED} className="link cursor-help">Simulated run</span> : f.source ? sourceLine(f.source, f.code_refs) : null}
              </p>
            </div>
        </FoundLine>
      </section>
    );
  }

  const running = state === "running" && diag;
  // The demo's run is simulated and ticks through its steps on a timer. A customer app's run is real: it reads the
  // repository (or the feedback alone), so its planned steps stay in progress until the finding replaces them with
  // what it did.
  const demo = running ? diag.simulated !== false : d.project.kind === "demo";
  const repo = d.project.repo_full_name;
  const planned = demo ? checkSteps(d.type, screenLabel(d), firstReporter(d)) : repo ? PLANNED_CODE_STEPS : PLANNED_FEEDBACK_STEPS;
  const steps = running && diag.steps.length ? diag.steps : planned;
  const at = running && demo ? stepAt(diag.started_at, clock, steps.length) : -1;
  const failed = diag?.status === "failed" || (diag?.status === "running" && !running);
  const aside = demo
    ? <span title={SIMULATED} className="cursor-help text-xs text-muted-foreground link">Simulated run</span>
    : <span className="max-w-[24ch] truncate text-xs text-muted-foreground">{repo ? `Reads ${repo}` : "Feedback only"}</span>;
  return (
    <Section title={check.panelTitle} aside={aside}>
      <p className="max-w-[56ch] text-[15px] leading-relaxed text-foreground/85">{check.panelBody}</p>
      <ol aria-live="polite" data-tour="first-step-progress" className="space-y-2">
        {steps.map((s, k) => {
          const done = running && demo && k < at;
          const current = running && (!demo || k === at || (at >= steps.length && k === steps.length - 1));
          return (
            <li key={s} className={`flex items-start gap-2.5 text-[15px] ${done || current ? "text-foreground" : "text-muted-foreground"}`}>
              <span aria-hidden className={`mt-[3px] grid size-4 shrink-0 place-items-center rounded-full border ${done ? "border-[var(--stage-diagnose)] bg-[var(--stage-diagnose)] text-white" : current ? "border-[var(--stage-diagnose)]" : "border-foreground/25"}`}>
                {done && <Check className="size-2.5" strokeWidth={3.5} />}
                {current && !done && <Loader2 className="size-3 animate-spin text-[var(--stage-diagnose)] motion-reduce:animate-none" />}
              </span>
              <span>{s}<span className="sr-only">{done ? ", done" : current ? ", in progress" : ""}</span></span>
            </li>
          );
        })}
      </ol>
      {!demo && !repo && !running && <p className="max-w-[56ch] text-sm text-muted-foreground">{FEEDBACK_ONLY_AHEAD}</p>}
      {failed && <p role="alert" className="text-sm text-[var(--stage-failed)]">{failedLine(diag?.error ?? null)}</p>}
      {running ? (
        <p className="text-sm text-muted-foreground">Started {timeAgo(diag.started_at, clock)}{diag.by ? ` by ${diag.by}` : ""}.{!demo && repo ? " Reading the code can take a minute or two." : ""} This page updates on its own.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button type="button" data-tour="first-step" onClick={onRun} disabled={busy} className="inline-flex h-11 items-center gap-2 btn-ink sheen px-5 text-[15px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}{failed ? `${check.button} again` : check.button}
          </button>
          <FollowupQuestions d={d} />
        </div>
      )}
      {error && <p role="alert" className="text-sm text-[var(--stage-failed)]">{error}</p>}
    </Section>
  );
}
