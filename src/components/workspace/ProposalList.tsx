"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import type { IssueDetail } from "@/lib/queries/issueDetail";
import type { Stage } from "@/components/triage/views";
import { changedSinceDraft, defaultScreens, editLocked, proposalFailure, provenanceLabel } from "@/lib/proposals";
import { checkOf } from "@/lib/diagnosis/checks";
import { ProposalCard } from "./ProposalCard";
import { ProposalForm } from "./ProposalForm";
import { Disclosure } from "@/components/ui/disclosure";
import { Section } from "./EvidencePanel";
import { mockupStatus } from "./DraftPanel";
import { HandoffButton } from "./HandoffButton";
import { CONNECT_REPO_TO_DRAW } from "@/lib/drafts/codeMockup";

type Props = {
  d: IssueDetail; stage: Stage; me: string | null; busy: string | null; error: string | null; generating: boolean;
  /** Still waiting on its first step: nothing to propose yet. */
  locked: boolean;
  /** Proposals are being written from a fresh first-step finding; any on file are about to be replaced. */
  writing: boolean;
  /** The drafted proposal's mock-up (DraftPanel), shown inside that proposal. */
  mockup: React.ReactNode;
  onImplement: (solutionId: string) => void; onGenerate: () => void; onEditingChange: (editing: boolean) => void;
};
type Editing = { target: string; notice?: string } | null; // target: a solution id, or "new" for Write your own



/**
 * The proposals for this issue, with the mock-up joined in: the drafted one leads and carries its mock-up, then the
 * recommended one, then the rest as rows. Every proposal can be edited in place, and the PM can write their own. One
 * form is open at a time, and unsaved work is never silently thrown away.
 */
export function ProposalList({ d, stage, me, busy, error, generating, locked, writing, mockup, onImplement, onEditingChange, onGenerate }: Props) {
  const router = useRouter();
  const drafted = d.draft?.solution_id ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  const [editing, setEditingState] = useState<Editing>(null);
  const [guard, setGuard] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const dirty = useRef(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const exists = (id: string | null) => !!id && d.solutions.some((s) => s.id === id);
  const selected = (exists(picked) ? picked : null) ?? (exists(drafted) ? drafted : null) ?? d.solutions.find((s) => s.recommended)?.id ?? d.solutions[0]?.id ?? null;
  const check = checkOf(d.type);
  const screenTitle = new Map(d.screens.map((s) => [s.frame_id, s.title]));
  const actionsLocked = stage === "drafting" || stage === "shipped";

  const setEditing = (e: Editing) => { setEditingState(e); dirty.current = false; onEditingChange(e !== null); };
  const open = (target: string, notice?: string) => {
    if (editing && editing.target !== target && dirty.current) { setGuard("Save or cancel this first"); return; }
    setGuard(null); setEditing({ target, notice });
  };
  const close = () => { setGuard(null); setEditing(null); };
  const flashSaved = (id: string) => { setSavedId(id); clearTimeout(savedTimer.current); savedTimer.current = setTimeout(() => setSavedId(null), 2200); };

  async function send(method: string, path: string, body?: object): Promise<{ error: string | null; id?: string }> {
    try {
      const res = await fetch(`/api/issues/${d.id}/solutions${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const j = (await res.json().catch(() => ({}))) as { error?: string; id?: string };
      return res.ok ? { error: null, id: j.id } : { error: j.error ?? "That didn't save. Try again." };
    } catch { return { error: "Couldn't reach PMA. Check your connection and try again." }; }
  }
  // PMA names a one-box proposal a few seconds after it's saved; refresh once more to pick the name up.
  const refreshForName = () => { router.refresh(); setTimeout(() => router.refresh(), 4000); };
  const saveEdit = (id: string) => async (text: string) => {
    const r = await send("PATCH", `/${id}`, { text });
    if (r.error) return r.error;
    close(); flashSaved(id); refreshForName();
    return null;
  };
  const saveNew = async (text: string) => {
    const r = await send("POST", "", { text });
    if (r.error) return r.error;
    close(); if (r.id) { setPicked(r.id); flashSaved(r.id); } refreshForName();
    return null;
  };
  const remove = (id: string) => async () => {
    const r = await send("DELETE", `/${id}`);
    if (r.error) return r.error;
    close(); router.refresh();
    return null;
  };
  const restore = async (id: string) => { const r = await send("PATCH", `/${id}`, { restore: true }); if (!r.error) { flashSaved(id); router.refresh(); } };
  // A customer app with a repository mocks up a proposal with no screens from its code (an approximate mock-up); without
  // one it can't yet. The demo's unmapped proposals keep their sentence.
  const customer = d.project.kind !== "demo";
  const fromCode = customer && !!d.project.repo_full_name;
  const implement = (s: IssueDetail["solutions"][number]) => {
    if (!s.target_frames.length && !fromCode) { setNotice(customer ? CONNECT_REPO_TO_DRAW : "This issue isn't matched to a screen yet, so it can't be mocked up."); return; }
    setNotice(null);
    onImplement(s.id);
  };

  const actionFor = (s: IssueDetail["solutions"][number]): string | null => {
    if (actionsLocked) return null;
    const isDrafted = s.id === drafted;
    const drift = changedSinceDraft(s, d.draft);
    if (stage === "failed" && isDrafted) return drift ? "Re-draft with your changes" : "Retry";
    if ((stage === "review" || stage === "in_review") && isDrafted) return drift ? "Re-draft with your changes" : null;
    // An approved mock-up is the one to build; another proposal can still be mocked up in its place.
    if (stage === "ready_to_build" && isDrafted) return null;
    if (stage === "review" || stage === "in_review" || stage === "ready_to_build" || stage === "failed") return "Mock this up instead";
    return provenanceLabel(s, me).label === "Yours" ? "Mock up your proposal" : "Mock it up";
  };
  const feedforward = (s: IssueDetail["solutions"][number]) => {
    const names = s.target_frames.map((f) => screenTitle.get(f) ?? f);
    if (!names.length) return fromCode ? "Drawn approximately from your code." : null;
    return `Drafted on ${names.length > 2 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : names.join(" and ")}.`;
  };
  const defaultFrame = defaultScreens(d.solutions, d.flow.map((f) => f.frame_id))[0];
  const found = d.diagnosis?.status === "done" ? d.diagnosis.finding?.headline ?? null : null;
  const form = (target: string, notice?: string) => {
    const s = d.solutions.find((x) => x.id === target);
    return (
      <div className="rise-in my-3 rounded-xl bg-card p-4 shadow-lift">
        {guard && <p role="alert" className="mb-3 text-sm text-[var(--stage-drafting)]">{guard}</p>}
        <ProposalForm
          key={target} mode={s ? "edit" : "create"} type={d.type} demo={d.project.kind === "demo"} initial={s ? s.summary : ""}
          screen={defaultFrame ? screenTitle.get(defaultFrame) ?? defaultFrame : null} notice={notice}
          recap={s ? undefined : { problem: d.problem_statement, found }}
          onSave={s ? saveEdit(s.id) : saveNew} onCancel={close} onDirtyChange={(x) => { dirty.current = x; }}
          onRemove={s?.origin === "pm" ? remove(s.id) : undefined}
        />
      </div>
    );
  };
  const writeOwn = !editing && stage !== "shipped" && (
    <button type="button" onClick={() => open("new")} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <Plus className="size-4" />{check.writeTitle}
    </button>
  );

  if (locked) {
    return (
      <Section title="Proposals">
        <p className="text-[15px] text-muted-foreground">Written from what the first step finds. Press {check.button} above to start.</p>
      </Section>
    );
  }

  const failure = proposalFailure(d.activity);
  if (!d.solutions.length || writing) {
    return (
      <Section title="Proposals" aside={!generating && writeOwn}>
        {editing?.target === "new" ? form("new") : generating ? (
          <p aria-live="polite" data-tour="writing-proposals" className="flex items-center gap-2 text-[15px] text-muted-foreground"><Loader2 className="size-4 animate-spin" />{d.diagnosis?.status === "done" ? "Writing proposals from what the first step found" : "Writing proposals"}. This page updates on its own.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-[15px] text-muted-foreground">Let PMA write options from the problem, the quotes and the screens, or write the fix you have in mind.</p>
            <button type="button" data-tour="write-proposals" onClick={onGenerate} disabled={busy !== null} className="inline-flex h-11 items-center gap-2 btn-ink sheen px-5 text-[15px] font-medium disabled:opacity-60">
              {busy === "generate" && <Loader2 className="size-4 animate-spin" />}Write proposals
            </button>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-[var(--stage-failed)]">{error}</p>}
        {/* A customer app says why proposals didn't come (the demo's page is unchanged). */}
        {!error && !generating && d.project.kind !== "demo" && failure && <p role="alert" className="text-sm text-[var(--stage-failed)]">{failure}</p>}
      </Section>
    );
  }

  // The drafted proposal leads (it carries the mock-up), then the recommended one, then the rest in rank order.
  const lead = (s: IssueDetail["solutions"][number]) => (s.id === drafted ? 0 : s.recommended ? 1 : 2);
  const ordered = [...d.solutions].sort((a, b) => lead(a) - lead(b) || a.rank - b.rank);
  const card = (s: IssueDetail["solutions"][number]) => editing?.target === s.id ? <div key={s.id}>{form(s.id, editing.notice)}</div> : (
    <ProposalCard
      key={s.id} s={s} me={me} selected={s.id === selected} onSelect={() => setPicked(s.id)}
      drift={changedSinceDraft(s, d.draft)} justSaved={savedId === s.id}
      lockReason={editLocked(stage, drafted, s.id)} action={actionFor(s)} busy={busy === `implement:${s.id}`} disabled={busy !== null || editing !== null}
      feedforward={feedforward(s)} onEdit={() => open(s.id)} onRestore={() => void restore(s.id)} onImplement={() => implement(s)}
      mockup={s.id === drafted && mockup ? (
        <Disclosure key={`${d.draft?.id}:${stage === "shipped"}`} defaultOpen={stage !== "shipped"} className="mt-2" buttonClassName="text-[15px] gap-2" label={<><span className="font-medium text-foreground">Mockup</span><span>{mockupStatus(stage)}</span></>}>
          {mockup}
        </Disclosure>
      ) : null}
    />
  );
  // Copy task for Claude Code is for the proposal in view: the one picked, else the mocked-up one, else the recommended one.
  const handoff = d.solutions.find((s) => s.id === selected) ?? null;
  // Once one is mocked up, the others fold away under one toggle: the mock-up is what's being decided.
  const [first, ...others] = ordered;
  const fold = !!mockup && first?.id === drafted && others.length > 0 && !others.some((s) => s.id === selected || editing?.target === s.id);
  return (
    <Section title={d.solutions.length > 1 ? `Proposals (${d.solutions.length})` : "Proposal"} aside={writeOwn}>
      {editing?.target === "new" && form("new")}
      <div role="radiogroup" aria-label="Proposals" className="divide-y divide-border">
        {fold ? (
          <>
            {card(first)}
            <Disclosure label={`${others.length} other ${others.length === 1 ? "proposal" : "proposals"}`} className="py-3" panelClassName="divide-y divide-border">
              {others.map(card)}
            </Disclosure>
          </>
        ) : ordered.map(card)}
      </div>
      {(error ?? notice) && <p role="alert" className="text-sm text-[var(--stage-failed)]">{error ?? notice}</p>}
      {/* A customer app hands the chosen proposal to its engineers; the demo keeps its mock-up flow as it was. Once its
          mock-up is approved, the hand-off lives in the mock-up's build panel instead. Beside a mock-up it drops its
          explanation line, so the page keeps to one screen. */}
      {d.project.kind !== "demo" && handoff && !editing && !(handoff.id === drafted && (stage === "ready_to_build" || stage === "shipped")) && (
        <HandoffButton issueId={d.id} solutionId={handoff.id} title={handoff.title}
          zip={handoff.id === drafted && d.draft?.status === "ready" && !!d.draft.after.length} hint={!mockup} onHandedOff={() => router.refresh()} />
      )}
    </Section>
  );
}
