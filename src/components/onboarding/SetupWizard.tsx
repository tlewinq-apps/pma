"use client";
// Start here, one step per screen: the rail of steps across the top (its fill glides to the step you're on, and the
// ring around the current dot moves with it), and the step itself, whose parts rise in as it slides in. When the
// step's connector is plugged in (the page refreshes with it done, or an OAuth hand-off comes back with ok), its tick
// pops in and Continue lights up. Back and Continue are links tagged nav-back and nav-forward, so the screen slides
// the way you're going.
import Link from "next/link";
import { ViewTransition, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, FileText, GitBranch, Hash, KeyRound, MessageSquareText, Activity, Bug, NotebookPen, PenTool, Sparkles, Users, Flag } from "lucide-react";
import { neighbours, type SetupStep, type SetupStepKey } from "@/lib/product/onboarding";

const ICONS: Record<SetupStepKey, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  intro: Sparkles, claude: KeyRound, github: GitBranch, product: FileText, slack: Hash, sentry: Bug, posthog: Activity,
  granola: NotebookPen, marver: PenTool, feedback: MessageSquareText, team: Users, done: Flag,
};

const primary = "inline-flex h-11 items-center gap-2 btn-ink sheen px-5 text-[15px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60";
const quiet = "inline-flex h-11 items-center gap-2 btn-paper px-4 text-[15px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60";

const stepHref = (path: string, key: SetupStepKey) => `${path}?step=${key}`;

/**
 * The steps across the top. Phones get a segmented bar, a segment a step. Wider screens get a dot a step (a tick once
 * done, the current one ringed) on a track that fills up to where you are; the dots share the width evenly, so the
 * track runs from the middle of the first step's share to the middle of the last one's, and the labels show once
 * there's room for them.
 */
export function SetupRail({ steps, current, path }: { steps: SetupStep[]; current: SetupStepKey; path: string }) {
  const { index } = neighbours(steps, current);
  const n = steps.length;
  const share = n > 1 ? index / (n - 1) : 0;
  const edge = `calc(100% / ${2 * n})`;
  const link = (s: SetupStep, i: number) => ({
    href: stepHref(path, s.key), transitionTypes: [i < index ? "nav-back" : "nav-forward"], "aria-current": s.key === current ? ("step" as const) : undefined,
    title: `${s.label}${s.done ? ", done" : s.optional ? ", optional" : ""}`,
  });
  return (
    <nav aria-label="Setup steps">
      <ol className="flex gap-1 sm:hidden">
        {steps.map((s, i) => (
          <li key={s.key} className="flex-1">
            <Link {...link(s, i)} className="block py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
              <span className={`block h-1.5 rounded-full transition-colors duration-300 ${s.done ? "bg-primary" : s.key === current ? "bg-primary/45" : "bg-border"} ${s.key === current ? "shadow-[0_0_0_2px_rgb(47_95_208/0.25)]" : ""}`} />
              <span className="sr-only">{s.label}</span>
            </Link>
          </li>
        ))}
      </ol>
      <div className="relative hidden sm:block">
        <span aria-hidden className="absolute top-[15px] h-0.5 rounded-full bg-border" style={{ left: edge, right: edge }} />
        <span aria-hidden className="setup-fill absolute top-[15px] h-0.5 rounded-full bg-primary" style={{ left: edge, width: `calc((100% - 100% / ${n}) * ${share})` }} />
        <ol className="relative flex">
          {steps.map((s, i) => {
            const here = s.key === current;
            return (
              <li key={s.key} className="flex min-w-0 flex-1 justify-center">
                <Link {...link(s, i)} className="group flex min-w-0 flex-col items-center gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
                  <span
                    className={`relative grid size-8 place-items-center rounded-full text-[13px] font-semibold transition-colors duration-300 ${
                      s.done ? "bg-primary text-primary-foreground" : here ? "bg-card text-primary shadow-[inset_0_0_0_2px_var(--primary)]" : "bg-card text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)] group-hover:text-foreground"
                    }`}
                  >
                    {s.done ? <Check aria-hidden className="size-4" strokeWidth={3} /> : i + 1}
                    {here && (
                      <ViewTransition name="setup-current" share="glide" default="none">
                        <span aria-hidden className="absolute -inset-1.5 rounded-full shadow-[0_0_0_2px_rgb(47_95_208/0.28)]" />
                      </ViewTransition>
                    )}
                  </span>
                  <span className={`sr-only whitespace-nowrap text-xs xl:not-sr-only ${here ? "font-medium text-foreground" : "text-muted-foreground group-hover:text-foreground"}`}>{s.label}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}

export type StepFrameProps = {
  steps: SetupStep[]; current: SetupStepKey; path: string;
  title: string; lead: React.ReactNode; done: boolean;
  /** What's now true, said once it's done ("Connected to acme/web"). */
  doneText?: string | null;
  /** The page came back from an OAuth hand-off with this step's connector: play the tick on load. */
  celebrate?: boolean;
  /** Continue's words on this step ("Start setup" on the welcome). */
  nextLabel?: string;
  /** Where the last step leads instead of a next step. */
  finish?: { label: string; href: string };
  children?: React.ReactNode;
};

/** One step: its icon, where it sits, its title and lead, what's done, its body, and Back and Continue. */
export function StepFrame({ steps, current, path, title, lead, done, doneText, celebrate = false, nextLabel, finish, children }: StepFrameProps) {
  const { prev, next, index } = neighbours(steps, current);
  const step = steps[index];
  const Icon = ICONS[current];
  // A step that turns done while you're on it (a key saved, a repository picked, a tool connected) celebrates once.
  const was = useRef(done);
  const [burst, setBurst] = useState(celebrate && done);
  useEffect(() => {
    if (done && !was.current) setBurst(true);
    was.current = done;
  }, [done]);
  const informational = current === "intro" || current === "done";
  const ready = done || informational;
  const nextWords = nextLabel ?? (ready ? "Continue" : step.optional ? "Skip for now" : "Do this later");

  return (
    <section aria-labelledby="setup-step-title" className="surface relative mt-8 overflow-hidden px-6 py-8 sm:px-10 sm:py-10">
      <div className="stagger">
        <div className="flex items-center gap-4">
          <span className="relative grid size-12 place-items-center rounded-2xl bg-[linear-gradient(135deg,#4a7ae6,#2246a8)] text-[#fbf9f4] shadow-[0_8px_20px_-8px_rgb(34_70_168/0.6)]">
            <Icon aria-hidden className="size-6" />
            {done && !informational && (
              <span className={`absolute -right-1.5 -bottom-1.5 grid size-5 place-items-center rounded-full bg-[var(--stage-ready)] text-white ring-2 ring-card ${burst ? "setup-pop" : ""}`}>
                <Check aria-hidden className="size-3" strokeWidth={3.5} />
              </span>
            )}
          </span>
          <p className="text-sm text-muted-foreground">
            Step {index + 1} of {steps.length} · {step.section}{step.optional ? " · Optional" : ""}
          </p>
        </div>
        <h1 id="setup-step-title" className="mt-6 text-4xl font-semibold text-balance sm:text-5xl">{title}</h1>
        <div className="mt-4 max-w-[62ch] text-[17px] leading-relaxed text-foreground/85">{lead}</div>
        {done && doneText && <Plugged text={doneText} burst={burst} />}
        {children && <div className="mt-7 max-w-[66ch] text-[15px] leading-relaxed text-foreground/85">{children}</div>}
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
        {prev ? (
          <Link href={stepHref(path, prev.key)} transitionTypes={["nav-back"]} className="inline-flex h-11 items-center gap-1.5 rounded-lg px-1 text-[15px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
            <ArrowLeft aria-hidden className="size-4" />Back
          </Link>
        ) : <span />}
        {next ? (
          <Link href={stepHref(path, next.key)} transitionTypes={["nav-forward"]} className={`${ready ? primary : quiet} ${burst ? "setup-glow" : ""}`}>
            {nextWords}<ArrowRight aria-hidden className="size-4" />
          </Link>
        ) : finish ? (
          <Link href={finish.href} transitionTypes={["nav-section"]} className={primary}>{finish.label}<ArrowRight aria-hidden className="size-4" /></Link>
        ) : null}
      </div>
    </section>
  );
}

const SPARKS = [0, 60, 120, 180, 240, 300];

/** What the step's connector did, with a tick that pops in, draws itself and rings out the first time. */
function Plugged({ text, burst }: { text: string; burst: boolean }) {
  return (
    <div role="status" className={`mt-6 inline-flex items-center gap-3 rounded-xl px-4 py-3 font-medium text-[var(--stage-ready)] ${burst ? "rise-in" : ""}`} style={{ background: "color-mix(in srgb, var(--stage-ready) 10%, transparent)" }}>
      <span className={`relative grid size-7 shrink-0 place-items-center rounded-full bg-[var(--stage-ready)] text-white ${burst ? "setup-pop" : ""}`}>
        {burst && <span aria-hidden className="setup-ring absolute inset-0 rounded-full bg-[var(--stage-ready)]" />}
        {burst && SPARKS.map((a) => (
          <span key={a} aria-hidden className="setup-spark absolute top-1/2 left-1/2 -mt-[3px] -ml-[3px] size-1.5 rounded-full" style={{ ["--a" as string]: `${a}deg`, background: a % 120 ? "var(--primary)" : "var(--stage-ready)" }} />
        ))}
        <svg viewBox="0 0 24 24" aria-hidden className="relative size-4">
          <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className={burst ? "setup-draw" : ""} />
        </svg>
      </span>
      {text}
    </div>
  );
}
