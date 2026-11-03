import Link from "next/link";
import type { IssueDetail } from "@/lib/queries/issueDetail";
import type { CommentPost, ProjectStep } from "@/lib/queries/projectHelpers";
import type { IssueStatus } from "@/lib/types";
import { stageOf } from "@/components/triage/views";
import { TYPE_LABEL, timeAgo } from "@/components/triage/format";
import { nextStep } from "@/lib/nextStep";
import { codeMockupStep } from "@/lib/drafts/codeMockup";
import { appHref } from "@/lib/links";
import { StageStepper } from "@/components/workspace/StageStepper";
import { ProjectFlows } from "./ProjectFlows";
import { CommentThread } from "./CommentThread";
import { ViewTransition } from "react";

// Picking another project crossfades the detail in place.
const SWITCH = { "project-switch": "swap", default: "none" };

function Timeline({ steps, now }: { steps: ProjectStep[]; now: number }) {
  if (!steps.length) return <p className="text-sm text-muted-foreground">Nothing done yet.</p>;
  return (
    <ol className="space-y-3 border-l border-border pl-4">{steps.map((s) => (
      <li key={s.id} className="relative">
        <span aria-hidden className="absolute -left-[20px] top-1.5 size-2 rounded-full bg-card ring-2 ring-foreground/25" />
        <p className="text-sm text-foreground">{s.what}</p>
        {s.why && <p className="mt-0.5 line-clamp-3 text-xs text-foreground/70" title={s.why}>{s.why}</p>}
        <p className="mt-0.5 text-xs text-muted-foreground">{s.who}, <time dateTime={s.at} title={new Date(s.at).toLocaleString()}>{timeAgo(s.at, now)}</time></p>
      </li>
    ))}</ol>
  );
}

/** One project: who owns it, how far it got, its before and after, what was done and why, and its conversation. */
export function ProjectDetail({ d, ownerName, steps, threads, isOwner, slackUrl, now, base }: {
  d: IssueDetail; ownerName: string; steps: ProjectStep[]; threads: CommentPost[]; isOwner: boolean; slackUrl: string | null; now: number; base: string;
}) {
  const issueHref = appHref(base, `/issues/${d.id}`);
  const stage = stageOf({ status: d.status as IssueStatus, draft: d.draft, proposal: { count: d.solutions.length }, type: d.type, diagnosis: d.diagnosis }, now);
  const recommended = d.solutions.find((s) => s.recommended) ?? d.solutions[0];
  const next = nextStep({
    stage, type: d.type, unaskedQuestions: !!d.followups?.questions.length && !d.followups.asked?.length, slackReporters: d.reporters.slack.length,
    recommendedHasScreens: !!recommended?.target_frames.length, othersToTell: d.reporters.others.length, backend: d.draft?.backend ?? "github",
    ...codeMockupStep(d),
  });
  return (
    <ViewTransition key={d.id} enter={SWITCH} exit={SWITCH} default="none">
    <article className="flex min-h-0 flex-1 flex-col gap-5">
      <header className="relative pl-6">
        <span aria-hidden className="absolute inset-y-1 left-0 w-[5px] rounded-full" style={{ background: `var(--type-${d.type})` }} />
        <h2 className="font-heading text-[clamp(1.8rem,2.6vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.02em]">
          <Link href={issueHref} className="hover:underline hover:decoration-1 hover:underline-offset-4">{d.title}</Link>
        </h2>
        <p className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-[15px] text-muted-foreground">
          <span className="font-semibold" style={{ color: `var(--type-${d.type})` }}>{TYPE_LABEL[d.type]}</span>
          <span>Owned by <span className="text-foreground">{ownerName}</span></span>
          <Link href={issueHref} className="link">Open the issue</Link>
          {slackUrl && <a href={slackUrl} target="_blank" rel="noreferrer" className="link">Open in Slack</a>}
        </p>
      </header>

      <StageStepper d={d} stage={stage} now={now} next={next} />

      <div className="grid min-h-0 flex-1 gap-x-10 gap-y-6 border-t border-border pt-4 lg:grid-cols-2">
        <div className="flex min-h-0 flex-col gap-5">
          <ProjectFlows d={d} />
          <section aria-labelledby="done" className="flex min-h-0 flex-1 flex-col gap-3">
            <h3 id="done" className="font-heading text-lg font-semibold">What&apos;s been done</h3>
            <div className="min-h-0 flex-1 overflow-y-auto pr-2"><Timeline steps={steps} now={now} /></div>
          </section>
        </div>
        <section aria-labelledby="talk" className="flex min-h-0 flex-col gap-3">
          <h3 id="talk" className="font-heading text-lg font-semibold">Updates and comments</h3>
          <CommentThread issueId={d.id} threads={threads} isOwner={isOwner} now={now} />
        </section>
      </div>
    </article>
    </ViewTransition>
  );
}
