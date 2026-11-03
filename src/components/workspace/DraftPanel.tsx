"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, GitPullRequest, Loader2, Maximize2, Route, TriangleAlert } from "lucide-react";
import type { IssueDetail } from "@/lib/queries/issueDetail";
import type { Stage } from "@/components/triage/views";
import { timeAgo } from "@/components/triage/format";
import { FlowDialog, mockupChanges, mockupShots, type Shot } from "./FlowDialog";
import { useApp } from "@/components/app/AppContext";
import { APPROXIMATE_LABEL, isApproximate, isStaleMockup, mockupFailure, MOCKUP_TOO_LONG } from "@/lib/drafts/codeMockup";
import type { BuildMode } from "@/lib/handoff/build";
import { BuildChoice } from "./BuildChoice";
import { BuildPanel } from "./BuildPanel";
import { LivePanel, useLive } from "./LivePreview";

type Props = {
  d: IssueDetail; stage: Stage; now: number; marverUrl: string | null; busy: string | null; error: string | null;
  /** The signed-in person's email: the issue's owner may link its pull request. */
  me?: string | null;
  /** Approve the draft; for a customer's approximate mock-up, with how it should be built. True when it went through. */
  onApprove: (body?: { build: BuildMode; branch?: string | null }) => Promise<boolean>; onRequestChanges: (note: string) => Promise<boolean>; onRetry: () => void;
  /** Create full flow (or try it again): the design agent plans and draws the whole flow from the Marver board. */
  onCreateFlow: () => Promise<boolean>;
};

const link = "inline-flex h-8 items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline";
const primary = "inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-[15px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60";

/** What the Mock-up toggle says beside its label. */
export function mockupStatus(stage: Stage): string {
  switch (stage) {
    case "drafting": return "Drafting";
    case "failed": return "Didn't finish";
    case "in_review": return "In review on GitHub";
    case "ready_to_build": return "Ready to build";
    case "shipped": return "Shipped";
    default: return "Ready for review";
  }
}

/** One side of the mock-up. A Marver shot fills a phone-shaped box; a screen drawn from code keeps its own shape (a
 *  desktop window or a phone), fitted inside the same height and a width cap. */
function Frame({ label, shot, accent, onOpen, openHref }: { label: string; shot: Shot | null; accent?: boolean; onOpen: () => void; openHref?: string | null }) {
  const box = "aspect-[390/844] h-[clamp(190px,27vh,330px)]";
  const img = shot?.contain ? "block h-auto w-full max-h-[clamp(190px,27vh,330px)] rounded-xl object-contain" : `${box} object-cover object-top`;
  return (
    <figure className={`${shot?.contain ? "min-w-0 flex-1" : "shrink-0"} space-y-1.5`}>
      <figcaption className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {accent && <span aria-hidden className="size-1.5 rounded-full bg-[var(--stage-ready)]" />}{label}
      </figcaption>
      {shot?.url ? (() => {
        const cls = `zoom-media sheen group relative block cursor-zoom-in rounded-xl border bg-card shadow-paper outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${shot.contain ? "w-full" : ""}`;
        const style = { borderColor: accent ? "var(--stage-ready)" : "var(--border)" };
        const inner = (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shot.url} alt={`${label}: ${shot.title}`} className={img} />
            <span aria-hidden className="absolute right-2 bottom-2 z-10 grid size-7 translate-y-1 place-items-center rounded-full bg-background/90 text-foreground opacity-0 shadow-paper backdrop-blur transition-[opacity,translate] duration-300 ease-smooth group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100"><Maximize2 className="size-3.5" /></span>
          </>
        );
        // A screen drawn from code opens on the mock-up's own page, today and proposed side by side at their own shape.
        return openHref
          ? <Link href={openHref} title="See this screen large, before and after" className={cls} style={style}>{inner}</Link>
          : <button type="button" onClick={onOpen} title="See this screen large, before and after" className={cls} style={style}>{inner}</button>;
      })() : (
        <div className={`${box} grid place-items-center rounded-xl border border-dashed border-foreground/20 p-3 text-center text-xs text-muted-foreground`}>{shot ? shot.title : "Not drafted"}</div>
      )}
    </figure>
  );
}

/** Current and proposed side by side, one screen at a time, paired by frame. Either opens that screen large. */
function FramePairs({ current, proposed, onOpen, openHref }: { current: Shot[]; proposed: Shot[]; onOpen: (frameId: string) => void; openHref?: string | null }) {
  const ids = [...new Set([...proposed, ...current].map((s) => s.frame_id))];
  const [k, setK] = useState(0);
  const at = Math.min(k, Math.max(0, ids.length - 1));
  const id = ids[at];
  // Shots drawn from code keep their own shape (a desktop window is wide). The pair takes a fixed width beside the
  // action column, so the issue page keeps to one screen; on a narrow screen it takes the whole row.
  const fitted = [...current, ...proposed].some((s) => s.contain);
  return (
    <div className={`${fitted ? "w-full min-w-0 sm:w-[290px] sm:shrink-0" : "w-max shrink-0"} space-y-2`}>
      <div className="flex gap-3">
        <Frame label="Current" shot={current.find((s) => s.frame_id === id) ?? null} onOpen={() => onOpen(id)} openHref={openHref} />
        <Frame label="Proposed" shot={proposed.find((s) => s.frame_id === id) ?? null} accent onOpen={() => onOpen(id)} openHref={openHref} />
      </div>
      {ids.length > 1 && (
        <div className="flex w-0 min-w-full items-center gap-1 text-xs text-muted-foreground">
          <button type="button" aria-label="Previous screen" disabled={at === 0} onClick={() => setK(at - 1)} className="grid size-6 place-items-center hover:text-foreground disabled:opacity-30"><ChevronLeft className="size-3.5" /></button>
          <span className="tabular-nums">{at + 1} of {ids.length}</span>
          <button type="button" aria-label="Next screen" disabled={at === ids.length - 1} onClick={() => setK(at + 1)} className="grid size-6 place-items-center hover:text-foreground disabled:opacity-30"><ChevronRight className="size-3.5" /></button>
          <span className="ml-1 truncate">{(proposed.find((s) => s.frame_id === id) ?? current.find((s) => s.frame_id === id))?.title}</span>
        </div>
      )}
    </div>
  );
}

/** The mock-up of the chosen proposal, shown inside that proposal: in progress, ready to review, approved (ready to
 *  build, for a customer app's approximate mock-up), shipped, or failed. */
export function DraftPanel({ d, stage, now, marverUrl, busy, error, me = null, onApprove, onRequestChanges, onRetry, onCreateFlow }: Props) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  // A customer's approximate mock-up asks how it should be built before it is approved.
  const [choosing, setChoosing] = useState(false);
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const router = useRouter();
  // Slack's View full flow links here with ?flow=1.
  const [flowOpen, setFlowOpen] = useState(useSearchParams().get("flow") === "1");
  const [flowAt, setFlowAt] = useState<string | null>(null);
  const { href, api, role } = useApp();
  const draft = d.draft;
  // See it live: an approved mock-up with an open pull request, in a company that connected GitHub.
  const live = useLive(d.id, stage === "ready_to_build" && !!draft && isApproximate(draft, d.project)
    && d.project.build_caps.githubConnected && d.pull_requests.some((p) => p.state === "open"));
  if (!draft) return null;
  const mock = draft.backend === "mock";
  // A customer app's mock-runner draft is an approximate mock-up drawn from its code: no pull request, no run log.
  const approximate = isApproximate(draft, d.project);
  // A mock runner's pull request is a page in this app; the stored URL is the one the runner reported to the callback.
  const prUrl = approximate ? null : draft.pr_url && (mock ? href(`/mock/pr/${draft.id}`) : draft.pr_url);
  const simulated = approximate ? null : draft.demo
    ? "Demo draft: rendered here because no design repo and GitHub token are connected. Approving marks it shipped without touching GitHub."
    : mock ? "Mock runner: the design agent edited the Marver frame and PMA drew it, through the same dispatch, upload and callback steps as a real Marver draft. Only GitHub is simulated: approving marks it shipped without touching GitHub." : null;
  const label = approximate && <p className="text-xs text-muted-foreground">{APPROXIMATE_LABEL}</p>;

  if (stage === "drafting") {
    return (
      <div className="space-y-1 pt-3" aria-live="polite">
        <p className="flex items-center gap-2 text-[15px] font-medium"><Loader2 className="size-4 animate-spin text-[var(--stage-drafting)]" />{approximate ? "Drawing an approximate mock-up from your code" : draft.demo ? "Rendering a demo mock-up" : mock ? "Drafting with the mock runner" : "Drafting in Marver"}</p>
        <p className="text-sm text-muted-foreground">Started {timeAgo(draft.created_at, now)}. This page updates on its own.</p>
        {approximate && <p className="text-xs text-muted-foreground">PMA reads the lines the first step found, draws the screen as it is today, then draws the proposal over it. It isn&apos;t a screenshot.</p>}
        {!draft.demo && !approximate && draft.branch && <p className="text-xs text-muted-foreground">The agent edits <code className="text-foreground/80">design/</code> on <code className="text-foreground/80">{draft.branch}</code>, then opens a pull request with before and after shots.</p>}
      </div>
    );
  }

  if (stage === "failed") {
    // The mock runner's reason, in one plain sentence (it is already mapped through friendlyLlmError). A run that was
    // killed before it could say anything reads as taking too long.
    const failure = approximate ? mockupFailure(draft.log_url) ?? (isStaleMockup(draft, d.project, now) ? MOCKUP_TOO_LONG : null) : null;
    return (
      <div className="space-y-3 pt-3" role="alert">
        <p className="flex items-center gap-2 text-[15px] font-medium"><TriangleAlert className="size-4 text-[var(--stage-failed)]" />The mock-up didn&apos;t finish</p>
        {approximate && failure && <p className="text-sm text-muted-foreground">{failure}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" data-tour="retry-draft" onClick={onRetry} disabled={busy !== null} className={`${primary} btn-ink sheen`}>{busy === "retry" && <Loader2 className="size-4 animate-spin" />}Retry</button>
          {draft.log_url && !approximate && <a className={link} href={draft.log_url} target="_blank" rel="noreferrer"><ExternalLink className="size-3.5" />View the run log</a>}
        </div>
        {error && <p className="text-sm text-[var(--stage-failed)]">{error}</p>}
      </div>
    );
  }

  if (stage !== "review" && stage !== "in_review" && stage !== "ready_to_build" && stage !== "shipped") return null;
  const shots = mockupShots(d);
  const send = async () => { if (await onRequestChanges(note)) { setAsking(false); setNote(""); } };
  const approveAs = async (mode: BuildMode, saveDefault: boolean, branch: string | null) => {
    setDefaultError(null);
    if (!(await onApprove({ build: mode, branch }))) return;
    setChoosing(false);
    if (!saveDefault) return;
    try {
      const res = await fetch(api("/build"), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, branch }) });
      if (!res.ok) setDefaultError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Approved, but the default didn't save.");
      else router.refresh();
    } catch { setDefaultError("Approved, but the default didn't save. Check your connection."); }
  };
  const approvedSolution = d.solutions.find((s) => s.id === draft.solution_id) ?? null;
  // Below the mock-up, across the whole row: what happens after the approval.
  const build = approximate && (stage === "ready_to_build" || stage === "shipped") ? (
    <div className="w-full">
      <BuildPanel d={d} me={me} now={now} solutionId={approvedSolution?.id ?? null} solutionTitle={approvedSolution?.title ?? d.title}
        zip={draft.status === "ready" && draft.after.length > 0} live={live.view} />
    </div>
  ) : null;
  // An approximate mock-up has no Marver frame: no canvas caption and no full flow (its frames entry only carries
  // the design agent's line on what changed, for Copy task).
  const edited = approximate ? null : draft.frames[0] ?? null;
  const changedLine = approximate ? draft.frames[0]?.changed ?? null : null;
  const flow = draft.flow;
  const flowLabel = !flow ? "Create full flow" : flow.state === "drafting" ? "Drafting the full flow" : flow.state === "failed" ? "Retry the full flow" : "View full flow";
  // The pop-up opens at once: whole from the flow button, or large on a mock-up screen's own step (`at`). With no full
  // flow yet it shows the mock-up's screens and starts drawing one (the server's rule: a ready mock-up with a Marver
  // frame); the button also retries.
  const showFlow = (retry: boolean, at: string | null = null) => {
    setFlowAt(at);
    setFlowOpen(true);
    if (edited && draft.status === "ready" && busy !== "flow" && (!flow || (retry && flow.state === "failed"))) void onCreateFlow();
  };
  const flowButton = edited && (
    <button
      type="button" disabled={busy === "flow"}
      onClick={() => showFlow(true)}
      className="btn-paper inline-flex h-8 items-center gap-1.5 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60"
    >
      {busy === "flow" || flow?.state === "drafting" ? <Loader2 className="size-3.5 animate-spin" /> : <Route className="size-3.5" />}{flowLabel}
    </button>
  );

  // What changed, beside the frames so the page keeps to one screen. The full path sits in the tooltip.
  const caption = edited && (
    <div className="space-y-1 text-sm">
      {edited.changed && <p title={edited.changed} className="line-clamp-4 leading-snug">{edited.changed}</p>}
      <p className="text-xs text-muted-foreground">Edited <code title={edited.path} className="text-foreground/80">{edited.path.split("/").pop()}</code> on the Marver canvas{draft.canvasUrl ? <>. <a className="link" href={draft.canvasUrl} target="_blank" rel="noreferrer">Open in Marver</a></> : null}</p>
    </div>
  );

  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-4 pt-3">
      <FramePairs current={shots.current} proposed={shots.proposed} onOpen={(id) => showFlow(false, id)} openHref={approximate ? href(`/mock/pr/${draft.id}`) : null} />
      <div className="flex min-w-[min(220px,100%)] flex-1 flex-col gap-2.5">
        {caption}
        {changedLine && <p title={changedLine} className={`${stage === "ready_to_build" || stage === "shipped" ? "line-clamp-3" : "line-clamp-4"} text-sm leading-snug`}>{changedLine}</p>}
        {label}
        {stage === "ready_to_build" ? (
          <>
            <p className="flex items-center gap-2 text-[15px] font-medium text-[var(--stage-ready)]"><CheckCircle2 className="size-4" />Approved. Ready to build</p>
            {defaultError && <p role="alert" className="text-sm text-[var(--stage-failed)]">{defaultError}</p>}
            {/* Beside the mock-up it was built from: the pull request's preview and its checks. */}
            {approximate && d.project.build_caps.githubConnected && d.pull_requests.some((p) => p.state === "open") && <LivePanel view={live.view} error={live.error} at={live.at} />}
          </>
        ) : stage === "shipped" ? (
          <>
            <p className="flex items-center gap-2 text-[15px] font-medium text-[var(--stage-shipped)]"><CheckCircle2 className="size-4" />Shipped{draft.demo ? " (demo)" : ""}</p>
            {(flow?.state === "ready" || prUrl) && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {flow?.state === "ready" && flowButton}
                {prUrl && <a className={link} href={prUrl} target="_blank" rel="noreferrer"><GitPullRequest className="size-3.5" />View the merged PR</a>}
              </div>
            )}
          </>
        ) : asking ? (
          <>
            <label htmlFor="change-note" className="text-[15px] font-medium">What should change?</label>
            <textarea id="change-note" autoFocus value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} placeholder="Keep the time picker, but put the confirmation above the fold" className="field w-full p-2.5 text-sm outline-none" />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={send} disabled={busy !== null || !note.trim()} className={`${primary} btn-ink sheen`}>{busy === "changes" && <Loader2 className="size-4 animate-spin" />}Send and re-draft</button>
              <button type="button" onClick={() => setAsking(false)} className="h-11 px-3 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
            </div>
          </>
        ) : (
          <>
            <button type="button" data-tour="approve" onClick={() => (approximate ? setChoosing(true) : void onApprove())} disabled={busy !== null} className={`${primary} sheen press rounded-lg bg-[var(--stage-ready)] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_6px_14px_-6px_rgb(42_112_70/0.6)] hover:brightness-110`}>{busy === "approve" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}{approximate ? "Approve the mock-up" : "Approve and ship"}</button>
            <button type="button" onClick={() => setAsking(true)} disabled={busy !== null} className="btn-paper inline-flex h-10 items-center justify-center gap-2 px-5 text-[15px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60">Request changes</button>
            {/* An approximate mock-up has no full flow, pull request or Marver link: no empty row. */}
            {(flowButton || prUrl || (marverUrl && !draft.demo && !mock)) && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {flowButton}
                {prUrl && <a className={link} href={prUrl} target="_blank" rel="noreferrer"><GitPullRequest className="size-3.5" />Open PR</a>}
                {marverUrl && !draft.demo && !mock && <a className={link} href={marverUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-3.5" />Open in Marver</a>}
              </div>
            )}
          </>
        )}
        {error && !(choosing && approximate) && <p role="alert" className="text-sm text-[var(--stage-failed)]">{error}</p>}
        {simulated && <p title={simulated} className="cursor-help text-xs text-muted-foreground"><span className="link">{draft.demo ? "Demo draft" : "Simulated draft"}</span></p>}
      </div>
      {build}
      {approximate && (stage === "review" || stage === "in_review") && (
        <BuildChoice open={choosing} saved={d.project.build_default} savedBranch={d.project.build_branch} caps={d.project.build_caps}
          canSaveDefault={role === "owner" || role === "admin"} busy={busy === "approve"} error={error}
          onConfirm={(mode, keep, branch) => void approveAs(mode, keep, branch)} onCancel={() => setChoosing(false)} />
      )}
      <FlowDialog open={flowOpen} onOpenChange={setFlowOpen} flow={flow} title={d.title} shots={shots} changes={mockupChanges(d)} openAt={flowAt} busy={busy === "flow"} error={error} onRetry={() => void onCreateFlow()} />
    </div>
  );
}
