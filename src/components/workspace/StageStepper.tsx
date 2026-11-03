import { Check } from "lucide-react";
import type { IssueDetail } from "@/lib/queries/issueDetail";
import type { Stage } from "@/components/triage/views";
import { timeAgo } from "@/components/triage/format";
import { checkOf } from "@/lib/diagnosis/checks";

type StepState = "done" | "current" | "failed" | "todo";
type Step = { key: string; label: string; state: StepState; at?: string; busy?: boolean };

/** Each step's state for one stage. Every issue starts with its first step (Diagnose, Scope, Find where it fits, Map the steps). */
export function stageSteps(d: IssueDetail, stage: Stage): Step[] {
  const at = (kinds: string[]) => d.activity.find((a) => kinds.includes(a.kind))?.at;
  const order: Stage[] = ["needs_diagnosis", "diagnosing", "needs_proposal", "proposal_ready", "failed", "drafting", "review", "in_review", "ready_to_build", "shipped"];
  const past = (s: Stage) => order.indexOf(stage) > order.indexOf(s);
  const state = (current: boolean, done: boolean): StepState => (done ? "done" : current ? "current" : "todo");
  const steps: Step[] = [];
  steps.push({ key: "diagnose", label: checkOf(d.type).step, state: state(stage === "needs_diagnosis" || stage === "diagnosing", past("diagnosing") || d.diagnosis?.status === "done"), at: d.diagnosis?.finished_at ?? at(["diagnosis_ready"]), busy: stage === "diagnosing" });
  // Ready to build: a customer app's approved mock-up. Review is done; shipping waits on the code pull request.
  const approved = stage === "ready_to_build" || stage === "shipped";
  const mocked = stage === "review" || stage === "in_review" || approved;
  steps.push(
    { key: "proposals", label: "Proposals", state: state(stage === "needs_proposal", d.solutions.length > 0 && past("needs_proposal")), at: at(["proposals_ready", "proposal_added"]) },
    { key: "mockup", label: stage === "failed" ? "Mockup failed" : "Mockup", state: stage === "failed" ? "failed" : state(stage === "proposal_ready" || stage === "drafting", mocked), at: mocked ? at(["draft_ready"]) : at(["draft_dispatched"]), busy: stage === "drafting" },
    { key: "review", label: "Review", state: state(stage === "review" || stage === "in_review", approved), at: stage === "ready_to_build" ? at(["approved"]) ?? at(["draft_ready"]) : at(["draft_ready"]) },
    { key: "shipped", label: "Shipped", state: stage === "shipped" ? "done" : stage === "ready_to_build" ? "current" : "todo", at: stage === "ready_to_build" ? undefined : at(["shipped"]) ?? at(["approved"]) ?? at(["pr_event"]) },
  );
  return steps;
}

const MARKER: Record<StepState, string> = {
  done: "border-foreground bg-foreground text-background",
  current: "border-brand bg-brand shadow-[0_0_0_5px_rgb(235_76_23/0.16)]",
  failed: "border-[var(--stage-failed)] bg-[var(--stage-failed)]",
  todo: "border-foreground/25 bg-transparent",
};

/** The route from report to shipped, with where this issue is and, under it, the one thing to do next. */
export function StageStepper({ d, stage, now, next }: { d: IssueDetail; stage: Stage; now: number; next: React.ReactNode }) {
  const steps = stageSteps(d, stage);
  return (
    <div className="space-y-2">
      <ol aria-label="Progress" className="grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, k) => (
          <li key={s.key} aria-current={s.state === "current" ? "step" : undefined} className="min-w-0">
            <div className="flex items-center">
              <span aria-hidden className={`grid size-5 shrink-0 place-items-center rounded-full border-2 transition-shadow duration-500 ${MARKER[s.state]} ${s.busy ? "animate-pulse motion-reduce:animate-none" : ""}`}>
                {s.state === "done" && <Check className="size-3" strokeWidth={3} />}
              </span>
              {k < steps.length - 1 && (
                <span aria-hidden className="relative mx-2 h-[3px] flex-1 overflow-hidden rounded-full bg-foreground/10">
                  {s.state === "done" && <span className="fill-x absolute inset-0 rounded-full bg-foreground/65" style={{ animationDelay: `${120 + k * 140}ms` }} />}
                </span>
              )}
            </div>
            <div className={`mt-2 truncate font-heading text-[19px] leading-tight ${s.state === "todo" ? "text-muted-foreground" : s.state === "failed" ? "text-[var(--stage-failed)]" : "text-foreground"} ${s.state === "current" ? "font-semibold" : ""}`}>
              {s.label}<span className="sr-only">{s.state === "done" ? ", done" : s.state === "current" ? ", current step" : ""}</span>
            </div>
            <div className="h-4 truncate text-xs text-muted-foreground">{s.state !== "todo" && s.at ? timeAgo(s.at, now) : ""}</div>
          </li>
        ))}
      </ol>
      <p className="max-w-[80ch] text-[15px] text-foreground/85">{next}</p>
    </div>
  );
}
