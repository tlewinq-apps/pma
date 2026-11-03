"use client";
import { ViewTransition, useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, MoreHorizontal, UserPlus } from "lucide-react";
import type { IssueDetail } from "@/lib/queries/issueDetail";
import type { Placement } from "@/lib/queries/issueAnalysis";
import type { Analysis } from "@/lib/analysis";
import { AnalysisPanel } from "@/components/analysis/AnalysisPanel";
import { marverBranchUrl } from "@/lib/queries/issueHelpers";
import { ISSUE_TYPES, type IssueStatus, type IssueType } from "@/lib/types";
import { IMPACT_TONE, TYPE_LABEL, impactLabel, initials } from "@/components/triage/format";
import { peopleWords } from "@/lib/proposals";
import { awaitingDiagnosis } from "@/lib/diagnosis/model";
import { nextStep, READY_TO_BUILD } from "@/lib/nextStep";
import { codeMockupStep, isApproximate, isStaleMockup } from "@/lib/drafts/codeMockup";
import { buildProgress } from "@/lib/handoff/build";
import { stageOf, type ViewId } from "@/components/triage/views";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DisclosureButton, DisclosurePanel } from "@/components/ui/disclosure";
import { ActivityList } from "@/components/issue/ActivityList";
import { EvidencePanel } from "./EvidencePanel";
import { FollowupPanel, ReportersPanel } from "./LoopPanels";
import { ErrorLinksPanel, type ErrorsView } from "./ErrorLinksPanel";
import { StageStepper } from "./StageStepper";
import { ProposalList } from "./ProposalList";
import { DraftPanel } from "./DraftPanel";
import { DiagnosisPanel, screenLabel } from "./DiagnosisPanel";
import { useApp } from "@/components/app/AppContext";

type Nav = { id: string; title: string } | null;
type Where = "proposals" | "draft" | "diagnosis";
const GENERATE_WAIT_MS = 180_000;
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const navButton = "press grid size-9 place-items-center rounded-full hover:bg-card hover:text-foreground hover:shadow-paper";
// The title came from (and goes back to) its Desk card.
const TITLE_MORPH = { "nav-forward": "title-morph", "nav-back": "title-morph", "nav-section": "title-morph", default: "none" };

/**
 * One issue, end to end, on one screen: what's wrong and their words on the left; on the right, the work surface
 * (its first step, then proposals with the mockup of the chosen one inside it). Deeper detail sits behind toggles.
 */
export function Workspace({ d, now, from, railLabel, prev, next, me, slackUrl = null, analysis, placement, posthog = null, sentry = null }: { d: IssueDetail; now: number; from: ViewId; railLabel: string; prev: Nav; next: Nav; me: string | null; slackUrl?: string | null; analysis: Analysis | null; placement: Placement | null; posthog?: ErrorsView | null; sentry?: ErrorsView | null }) {
  const router = useRouter();
  const { href, role } = useApp();
  // Why it matters lives in the URL (?why=1), so a link (or the feedback page) can open it and a refresh keeps it.
  const searchParams = useSearchParams();
  const whyOpen = searchParams.get("why") === "1";
  const setWhyOpen = (open: boolean) => {
    const p = new URLSearchParams(searchParams.toString());
    if (open) p.set("why", "1"); else p.delete("why");
    const q = p.toString();
    window.history.replaceState(null, "", q ? `?${q}` : window.location.pathname);
  };
  // Right after a diagnosis, proposals are being written from it: until they land (or that fails), the ones already on
  // file are about to be replaced, so the page waits for the new ones instead of showing the old.
  const diagnosedAt = d.diagnosis?.status === "done" ? d.diagnosis.finished_at ?? null : null;
  const writingFromDiagnosis = !!diagnosedAt && now - Date.parse(diagnosedAt) < GENERATE_WAIT_MS
    && !d.activity.some((a) => (a.kind === "proposals_ready" || a.kind === "lane_action_failed") && a.at >= diagnosedAt);
  // An approximate mock-up whose run was killed reads as failed (with Retry) instead of drawing forever.
  const staleDraft = isStaleMockup(d.draft, d.project, now);
  const derived = stageOf({ status: d.status as IssueStatus, draft: d.draft, proposal: { count: d.solutions.length }, type: d.type, diagnosis: d.diagnosis, staleDraft }, now);
  const stage = writingFromDiagnosis && derived === "proposal_ready" ? "needs_proposal" : derived;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ where: Where; msg: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [editingProposal, setEditingProposal] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const activityId = useId();
  const qs = from === "all" ? "" : `?from=${encodeURIComponent(from)}`;
  const hrefTo = (id: string) => href(`/issues/${id}${qs}`);
  const backHref = href(`/?${from === "all" ? "" : `view=${encodeURIComponent(from)}&`}focus=${d.id}`);
  const locked = awaitingDiagnosis(d.type, d.diagnosis, now);
  const waitingForProposals = writingFromDiagnosis || (d.solutions.length === 0 && generating);

  useEffect(() => { void fetch(`/api/issues/${d.id}/view`, { method: "POST" }); }, [d.id]);
  // Diagnoses, drafts and proposals finish on the server; refresh the page data until they land.
  useEffect(() => {
    if (stage !== "drafting" && stage !== "diagnosing" && !waitingForProposals && d.draft?.flow?.state !== "drafting") return;
    const tick = setInterval(() => router.refresh(), 3000);
    const giveUp = generating ? setTimeout(() => setGenerating(false), GENERATE_WAIT_MS) : undefined;
    return () => { clearInterval(tick); clearTimeout(giveUp); };
  }, [stage, waitingForProposals, generating, router, d.draft?.flow?.state]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingProposal || typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return; // a proposal form owns the keyboard
      if (document.querySelector("[data-slot=flow-dialog], [data-slot=analysis-panel], [data-slot=build-choice]")) return; // a pop-up owns Esc and the keyboard
      if (e.key === "Escape" && !document.querySelector("[data-slot=dropdown-menu-content]")) router.push(backHref, { transitionTypes: ["nav-back"] });
      else if ((e.key === "j" || e.key === "]") && next) router.push(hrefTo(next.id), { transitionTypes: ["nav-forward"] });
      else if ((e.key === "k" || e.key === "[") && prev) router.push(hrefTo(prev.id), { transitionTypes: ["nav-back"] });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function call(key: string, path: string, body: object | null, where: Where): Promise<boolean> {
    setBusy(key); setError(null);
    try {
      const res = await fetch(`/api/issues/${d.id}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError({ where, msg: j.error ?? "That didn't work. Try again." });
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError({ where, msg: "Couldn't reach PMA. Check your connection and try again." });
      return false;
    } finally { setBusy(null); }
  }
  const patch = async (body: object) => { await fetch(`/api/issues/${d.id}`, { method: "PATCH", body: JSON.stringify(body) }); router.refresh(); };
  const implement = (solutionId: string) => call(`implement:${solutionId}`, "draft", { solutionId }, "proposals");
  const generate = async () => { if (await call("generate", "propose", null, "proposals")) setGenerating(true); };
  const dismiss = async () => {
    if (!window.confirm("Dismiss this issue? It leaves the hub.")) return;
    await fetch(`/api/issues/${d.id}`, { method: "PATCH", body: JSON.stringify({ dismiss: true }) });
    router.push(href("/"));
  };

  const runDiagnostics = () => void call("diagnose", "diagnose", null, "diagnosis");

  const recommended = d.solutions.find((s) => s.recommended) ?? d.solutions[0];
  // Ready to build: hand it off, link the pull request, then mark it shipped (lib/handoff/build.ts).
  const building = stage === "ready_to_build" ? buildProgress(d) : null;
  const nextAction = nextStep({
    stage, type: d.type, unaskedQuestions: !!d.followups?.questions.length && !d.followups.asked?.length, slackReporters: d.reporters.slack.length,
    recommendedHasScreens: !!recommended?.target_frames.length, othersToTell: d.reporters.others.length, backend: d.draft?.backend ?? "github",
    writingProposals: waitingForProposals, ...codeMockupStep(d),
    build: building ? { next: building.next, mayShip: role === "owner" || role === "admin" } : undefined,
  });
  const flow = screenLabel(d) ?? "Unmapped";
  const severity = d.breakdown?.inputs?.severity ?? d.breakdown?.severity ?? null;
  const impact = impactLabel(severity);
  const activityCount = d.activity.filter((a) => a.kind !== "viewed").length;
  const showDraft = d.draft && (stage === "drafting" || stage === "review" || stage === "in_review" || stage === "ready_to_build" || stage === "shipped" || stage === "failed");
  // Ready to build points at the Copy task button: its words in the next-step line take you there.
  const pointToHandoff = () => {
    const b = document.querySelector<HTMLButtonElement>("[data-handoff]");
    if (!b) return;
    b.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    b.focus({ preventScroll: true });
  };
  const nextLine = stage === "ready_to_build" && building?.next === "hand_off" ? (
    <>{READY_TO_BUILD.lead}<button type="button" onClick={pointToHandoff} className="link font-medium text-foreground">{READY_TO_BUILD.action}</button>{READY_TO_BUILD.tail}</>
  ) : nextAction;
  const mockup = showDraft ? (
    <DraftPanel
      d={d} stage={stage} now={now} marverUrl={marverBranchUrl(d.project.repo_full_name, d.draft?.branch, d.project.design_path)}
      busy={busy} error={error?.where === "draft" ? error.msg : null}
      me={me} onApprove={(body) => call("approve", "approve", body ?? null, "draft")}
      onRequestChanges={(note) => call("changes", "request-changes", { note }, "draft")}
      onRetry={() => d.draft?.solution_id && void call("retry", "draft", { solutionId: d.draft.solution_id }, "draft")}
      onCreateFlow={() => call("flow", "flow", null, "draft")}
    />
  ) : null;

  return (
    // The welcome tour (components/app/Tour.tsx) reads where this issue stands from these two attributes.
    <div data-tour-issue={d.id} data-tour-stage={waitingForProposals && stage === "needs_proposal" ? "writing" : stage} data-tour-mockup={isApproximate(d.draft, d.project) ? "approximate" : undefined} className="mx-auto flex min-h-full max-w-[1480px] flex-col px-6 pt-4 pb-4 lg:px-10">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <Link href={backHref} transitionTypes={["nav-back"]} title="Back to the desk (Esc)" className="link hover:text-foreground">Desk</Link><ChevronRight aria-hidden className="size-3.5 shrink-0" />
          <Link href={backHref} transitionTypes={["nav-back"]} className="link hover:text-foreground">{railLabel}</Link>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Link aria-disabled={!prev} tabIndex={prev ? 0 : -1} href={prev ? hrefTo(prev.id) : "#"} transitionTypes={["nav-back"]} title={prev ? `Previous: ${prev.title} (K)` : undefined} className={`${navButton} ${prev ? "" : "pointer-events-none opacity-30"}`}><ChevronLeft className="size-4" /><span className="sr-only">Previous</span></Link>
          <Link aria-disabled={!next} tabIndex={next ? 0 : -1} href={next ? hrefTo(next.id) : "#"} transitionTypes={["nav-forward"]} title={next ? `Next: ${next.title} (J)` : undefined} className={`${navButton} ${next ? "" : "pointer-events-none opacity-30"}`}><ChevronRight className="size-4" /><span className="sr-only">Next</span></Link>
          {d.owner_id ? (
            <button type="button" onClick={() => patch({ assign: null })} title={`Owner ${d.owner_email ?? ""}. Click to unassign`} className="press ml-2 flex h-9 items-center gap-2 rounded-full pl-1.5 pr-3 hover:bg-card hover:text-foreground hover:shadow-paper">
              <span className="grid size-6 place-items-center rounded-full bg-card text-[10px] font-semibold text-foreground shadow-paper">{d.owner_email ? initials(d.owner_email) : "?"}</span>Unassign
            </button>
          ) : (
            <button type="button" onClick={() => patch({ assign: "me" })} title="Nobody owns this yet. Take it on" className="ask-owner sheen press ml-2 inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-strong bg-linear-to-b from-[#3a68d6] to-brand-strong px-3.5 text-sm font-semibold text-white outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2"><UserPlus className="size-4" />Assign me</button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger aria-label="More actions" className={`${navButton} outline-none focus-visible:ring-2 focus-visible:ring-ring/60`}><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Re-label as</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {ISSUE_TYPES.map((t) => <DropdownMenuItem key={t} disabled={t === d.type} onClick={() => patch({ type: t as IssueType })}>{TYPE_LABEL[t]}</DropdownMenuItem>)}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={dismiss}>Dismiss</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>

      <header className="relative mt-3 pl-6">
        <span aria-hidden className="absolute inset-y-1 left-0 w-[5px] rounded-full" style={{ background: `var(--type-${d.type})` }} />
        <ViewTransition name={`issue-title-${d.id}`} share={TITLE_MORPH} default="none">
        <textarea
          key={`${d.id}:${d.title}`} aria-label="Issue title" defaultValue={d.title} maxLength={80} rows={1}
          onBlur={(e) => { const t = e.target.value.replace(/\s+/g, " ").trim(); if (t && t !== d.title) void patch({ title: t }); else e.target.value = d.title; }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); e.currentTarget.blur(); } }}
          className="-mx-2 block w-full resize-none overflow-hidden rounded-xl bg-transparent px-2 font-heading text-[clamp(2.4rem,4.1vw,3.75rem)] font-semibold leading-[1.04] tracking-[-0.025em] outline-none transition-[background-color,box-shadow] duration-200 [field-sizing:content] hover:bg-foreground/[0.03] focus:bg-card focus:shadow-paper"
        />
        </ViewTransition>
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[15px] text-muted-foreground">
          <span className="font-semibold" style={{ color: `var(--type-${d.type})` }}>{TYPE_LABEL[d.type]}</span>
          <span>{flow}</span>
          <span>{peopleWords(d.people_count, d.audiences, d.project.profile)}</span>
          {impact && <span className={`font-semibold ${IMPACT_TONE[Math.round(severity!)]}`}>{impact}</span>}
          <DisclosureButton open={showActivity} onToggle={() => setShowActivity((v) => !v)} controls={activityId} className="text-[15px]">
            Activity<span className="tabular-nums text-muted-foreground/80">{activityCount}</span>
          </DisclosureButton>
          {slackUrl && <a href={slackUrl} target="_blank" rel="noreferrer" data-tour="open-in-slack" className="link">Open in Slack</a>}
        </div>
        <DisclosurePanel id={activityId} open={showActivity}>
          <div className="mt-4 max-h-60 overflow-y-auto rounded-xl bg-card px-4 py-3 shadow-paper"><ActivityList d={d} now={now} /></div>
        </DisclosurePanel>
      </header>

      <div className="mt-4"><StageStepper d={d} stage={stage} now={now} next={nextLine} /></div>

      <div className="mt-5 grid flex-1 items-start gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <EvidencePanel d={d} onWhy={() => setWhyOpen(true)} />
        <div className="surface space-y-3 px-6 py-4 sm:px-7">
          <DiagnosisPanel d={d} now={now} busy={busy === "diagnose"} error={error?.where === "diagnosis" ? error.msg : null} onRun={runDiagnostics} />
          <hr className="border-border" />
          {d.type !== "bug" && d.diagnosis?.status === "done" && <FollowupPanel d={d} />}
          <ProposalList
            d={d} stage={stage} me={me} busy={busy} error={error?.where === "proposals" ? error.msg : null} generating={waitingForProposals || busy === "generate"}
            locked={locked} writing={writingFromDiagnosis} mockup={mockup} onImplement={implement} onGenerate={generate} onEditingChange={setEditingProposal}
          />
          <ReportersPanel d={d} />
          <ErrorLinksPanel tool="posthog" issueId={d.id} initial={posthog} />
          <ErrorLinksPanel tool="sentry" issueId={d.id} initial={sentry} />
        </div>
      </div>
      <AnalysisPanel open={whyOpen} onOpenChange={setWhyOpen} d={d} a={analysis} placement={placement} />
    </div>
  );
}
