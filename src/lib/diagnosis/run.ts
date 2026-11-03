// The first step, database side (the pure core is model.ts, the per-type words checks.ts). startDiagnosis claims an
// issue for one run; runDiagnosis plays it, saves the finding, then has proposals written from it. The demo's run is
// simulated; a customer app's reads its connected repository (lib/repo/context.ts) and cites the lines it rests on, or
// works from the feedback alone and says so. Both use the service client: callers check the person may act on the
// issue first (RLS read on the web, the workspace member check in Slack).
import { serviceDb } from "@/lib/db/server";
import { callStructured, claudeReady, type StructuredCaller } from "@/lib/llm/client";
import { withIssueClaude } from "@/lib/llm/scope";
import { friendlyLlmError } from "@/lib/llm/errors";
import { promptsFor } from "@/lib/llm/prompts";
import { profileOfEmbedded, type ProductProfile, type ProfileSource } from "@/lib/product/profile";
import {
  DiagnoseCodeOut, DiagnoseFeedbackOut, DiagnoseOut, FitCodeOut, FitOut, ScopeCodeOut, ScopeOut, StepsCodeOut, StepsOut,
} from "@/lib/pipeline/schemas";
import { openRepo, type RepoSnapshot } from "@/lib/repo/snapshot";
import { asksForMore, citedRefs, codeRefsWithin, formatContext, gatherCodeContext, lookAgain, type CodeContext, type NeedMore } from "@/lib/repo/context";
import { assignIfUnowned } from "@/lib/actions/takeOn";
import { proposeOnly } from "@/lib/actions/solveAndDraft";
import { logLaneActionFailed } from "@/lib/actions/laneFailure";
import { TYPE_LABEL, flowLabel } from "@/components/triage/format";
import type { IssueType } from "@/lib/types";
import { DIAGNOSIS_RUN_MS, diagnosisState, parseDiagnosis, type CodeRef, type Diagnosis, type DiagnosisFinding, type FindingSource } from "./model";
import {
  PLANNED_CODE_STEPS, PLANNED_FEEDBACK_STEPS, checkOf, checkSteps, codeRunSteps, fallbackFinding, feedbackRunSteps, resultLines,
} from "./checks";

export type StartResult = { ok: true } | { ok: false; status: number; error: string };

type IssueRow = {
  id: string; type: string; title: string; problem_statement: string; owner_id: string | null; diagnosis: unknown;
  score_breakdown: { suspected_cause?: string } | null;
  issue_screens: { position: number; screens: { frame_id: string; title: string | null } | null }[] | null;
  feedback_units: { quote: string; speakers: string[] | null; sources: { author: string | null; channel?: string | null } | null }[] | null;
  /** The app the issue is in: the finding is written about its product (profileOf), from its repository if it has one. */
  projects: (ProfileSource & { repo_full_name?: string | null; watched_branch?: string | null; org_id?: string | null }) | null;
};

/** A customer app's run can't make a finding up, so with no model key it fails and says why. */
export const NEEDS_KEY_CODE = "PMA needs a Claude key to read your code.";
export const NEEDS_KEY = "PMA needs a Claude key to write the finding.";

async function loadIssue(issueId: string): Promise<IssueRow | null> {
  const { data, error } = await serviceDb().from("issues")
    .select("id, type, title, problem_statement, owner_id, diagnosis, score_breakdown, issue_screens(position, screens(frame_id, title)), feedback_units(quote, speakers, sources(author, channel)), projects(kind, product_profile, name, repo_full_name, watched_branch, org_id)")
    .eq("id", issueId).maybeSingle();
  if (error) throw new Error(`diagnosis: load issue failed: ${error.message}`);
  return data as unknown as IssueRow | null;
}

/** "Messages › Message thread", as the issue header names it. */
function screenOf(i: IssueRow): { label: string | null; frames: string[] } {
  const s = [...(i.issue_screens ?? [])].sort((a, b) => a.position - b.position).map((x) => x.screens).filter((x): x is NonNullable<typeof x> => !!x);
  if (!s.length) return { label: null, frames: [] };
  return { label: flowLabel(`${s[0].frame_id.split("/")[0]} › ${s.at(-1)!.title ?? s.at(-1)!.frame_id}`), frames: s.map((x) => x.frame_id) };
}
const reporterOf = (i: IssueRow) => { const u = i.feedback_units?.[0]; return u ? u.speakers?.find((p) => p.trim()) ?? u.sources?.author ?? null : null; };

/**
 * Starts an issue's first step: refuses a run already going and one that's finished. The claim is compare-and-set
 * on the diagnosis it read, so two clicks (web and Slack) cannot both start one. Whoever runs it takes the issue on
 * if nobody has.
 */
export async function startDiagnosis(issueId: string, userId: string, by: string | null, via: "web" | "slack"): Promise<StartResult> {
  const db = serviceDb();
  const i = await loadIssue(issueId);
  if (!i) return { ok: false, status: 404, error: "not found" };
  const check = checkOf(i.type);
  const prev = parseDiagnosis(i.diagnosis);
  const state = diagnosisState(i.type, prev);
  if (state === null) return { ok: false, status: 400, error: "This isn't an issue PMA can work on." };
  if (state === "running") return { ok: false, status: 409, error: `${check.running} already.` };
  if (state === "done") return { ok: false, status: 409, error: `Already done: ${check.done.replace(/\.$/, "").toLowerCase()}.` };

  // The demo ticks through its simulated steps; a customer app's run shows its plan until the real steps replace it.
  profileOfEmbedded(i.projects, "diagnosis");
  const demo = i.projects!.kind === "demo";
  const steps = demo ? checkSteps(i.type, screenOf(i).label, reporterOf(i)) : i.projects!.repo_full_name ? PLANNED_CODE_STEPS : PLANNED_FEEDBACK_STEPS;
  const next: Diagnosis = { status: "running", started_at: new Date().toISOString(), by, steps, simulated: demo };
  const claim = db.from("issues").update({ diagnosis: next, updated_at: next.started_at }).eq("id", issueId);
  const { data, error } = await (prev ? claim.eq("diagnosis->>started_at", prev.started_at) : claim.is("diagnosis", null)).select("id");
  if (error) throw new Error(`diagnosis: claim failed: ${error.message}`);
  if (!data?.length) return { ok: false, status: 409, error: `${check.running} already.` };

  if (!i.owner_id) await assignIfUnowned(db, issueId, userId, via);
  await db.from("activity").insert({ issue_id: issueId, user_id: userId, kind: "diagnosis_started", payload: { type: i.type, screen: screenOf(i).label, via } });
  return { ok: true };
}

/** Where the feedback was given or what people were doing ("Using the Studio on the web"): its sources' channels. */
const whereOf = (i: IssueRow) => [...new Set((i.feedback_units ?? []).map((u) => u.sources?.channel?.trim()).filter((c): c is string => !!c))].slice(0, 3);

/** The model input every type shares: the issue, its screens and what people said. A customer app's (`about`) also
 *  says where it was reported and the app's platform, so the right platform's code is read; the demo's is unchanged. */
function findingInput(i: IssueRow, screen: { label: string | null; frames: string[] }, about?: { platform: ProductProfile["platform"] }): string[] {
  const where = about ? whereOf(i) : [];
  return [
    `${TYPE_LABEL[i.type as IssueType] ?? "Issue"}: ${i.title}`,
    i.problem_statement,
    `Screen: ${screen.label ?? "unmapped"}${screen.frames.length ? ` (${screen.frames.join(" → ")})` : ""}`,
    ...(where.length ? [`Reported from: ${where.join("; ")}`] : []),
    ...(about ? [`Platform: ${about.platform}`] : []),
    ...(i.score_breakdown?.suspected_cause ? [`What the rating thought before the run: ${i.score_breakdown.suspected_cause}`] : []),
    "Quotes:",
    ...(i.feedback_units ?? []).slice(0, 6).map((u) => `- ${u.quote}`),
  ];
}

const quotesOf = (i: IssueRow) => (i.feedback_units ?? []).slice(0, 6).map((u) => u.quote);

/**
 * The finding from the feedback, written by the model about the issue's app: the demo's simulated prompts, or a
 * customer app's feedback-only ones (which never confirm a cause). Without a model key the demo's is built from the
 * rating and a customer app's run fails. Exported for tests.
 */
export async function writeFinding(llm: StructuredCaller, i: IssueRow): Promise<DiagnosisFinding> {
  const screen = screenOf(i);
  const profile = profileOfEmbedded(i.projects, "diagnosis");
  const demo = i.projects!.kind === "demo";
  if (!claudeReady()) {
    if (!demo) throw new Error(i.projects!.repo_full_name ? NEEDS_KEY_CODE : NEEDS_KEY);
    return fallbackFinding(i.type, { title: i.title, problem: i.problem_statement, suspected_cause: i.score_breakdown?.suspected_cause, screen: screen.label, reporter: reporterOf(i) });
  }
  const prompts = promptsFor(profile);
  const user = findingInput(i, screen, demo ? undefined : profile).join("\n");
  const base = { logging_added: [] as string[], confidence: "likely" as const };
  // A customer app's finding says it came from the feedback (and which repository, if one is connected); the demo's
  // simulated one is stored exactly as it always was.
  const from: { source?: FindingSource } = demo ? {} : { source: { repo: i.projects!.repo_full_name ?? null, ref: null, read: false } };
  switch (i.type) {
    case "new_feature": {
      const o = await llm({ system: prompts.scope, user, schema: ScopeOut, effort: "medium" });
      return { ...base, headline: o.headline, facts: [{ label: "Who wants it", text: o.who_wants_it }, { label: "How they cope today", text: o.how_they_cope }], evidence: o.evidence, where: o.where, ...from };
    }
    case "add_on": {
      const o = await llm({ system: prompts.fit, user, schema: FitOut, effort: "medium" });
      return { ...base, headline: o.headline, facts: [{ label: "There today", text: o.there_today }, { label: "It touches", text: o.it_touches }], evidence: o.evidence, where: o.where, ...from };
    }
    case "streamline": {
      const o = await llm({ system: prompts.steps, user, schema: StepsOut, effort: "medium" });
      return { ...base, headline: o.headline, facts: [{ label: "Steps today", text: o.steps_today }, { label: "Where people stall", text: o.where_people_stall }], evidence: o.evidence, where: o.where, ...from };
    }
    default: {
      if (!demo) {
        // Nothing was run, so a customer app's bug claims no logging; the feedback alone can't confirm a cause.
        const o = await llm({ system: prompts.diagnose, user, schema: DiagnoseFeedbackOut, effort: "medium" });
        return { headline: o.cause, cause: o.cause, facts: [], evidence: o.evidence, logging_added: [], where: o.where, confidence: "likely", ...from };
      }
      const o = await llm({ system: prompts.diagnose, user, schema: DiagnoseOut, effort: "medium" });
      return { headline: o.cause, cause: o.cause, facts: [], evidence: o.evidence, logging_added: o.logging_added, where: o.where, confidence: o.confidence };
    }
  }
}

/** The finding from code that was read: the type's code-reading prompt and schema. Its references are the model's that
 *  point inside the excerpts, then any `path:line` its own sentences cite inside them (citedRefs), each once. `need`
 *  is what the model asked to read next (empty when the excerpts were enough). */
async function writeCodeFinding(llm: StructuredCaller, i: IssueRow, prompts: ReturnType<typeof promptsFor>, user: string, code: CodeContext): Promise<{ finding: DiagnosisFinding; need: NeedMore }> {
  const refs = (raw: CodeRef[], said: string[]) => {
    const given = codeRefsWithin(raw.map((r) => ({ path: r.path, line: r.line, note: r.note })), code.excerpts);
    if (given.length < raw.length) console.warn(`[diagnosis] dropped ${raw.length - given.length} code reference(s) outside the excerpts read`, i.id);
    return codeRefsWithin([...given, ...citedRefs(said, code.excerpts)], code.excerpts).slice(0, 8);
  };
  const base = { logging_added: [] as string[], confidence: "likely" as const, source: { repo: code.repo, ref: code.ref, read: true } };
  const needOf = (n: NeedMore | undefined): NeedMore => ({ ranges: n?.ranges ?? [], terms: n?.terms ?? [] });
  switch (i.type) {
    case "new_feature": {
      const o = await llm({ system: prompts.scopeCode, user, schema: ScopeCodeOut, effort: "medium" });
      return { need: needOf(o.need_more), finding: { ...base, headline: o.headline, facts: [{ label: "Who wants it", text: o.who_wants_it }, { label: "How they cope today", text: o.how_they_cope }], evidence: o.evidence, where: o.where, code_refs: refs(o.code_refs, [o.headline, o.who_wants_it, o.how_they_cope, ...o.evidence, o.where]) } };
    }
    case "add_on": {
      const o = await llm({ system: prompts.fitCode, user, schema: FitCodeOut, effort: "medium" });
      return { need: needOf(o.need_more), finding: { ...base, headline: o.headline, facts: [{ label: "There today", text: o.there_today }, { label: "It touches", text: o.it_touches }], evidence: o.evidence, where: o.where, code_refs: refs(o.code_refs, [o.headline, o.there_today, o.it_touches, ...o.evidence, o.where]) } };
    }
    case "streamline": {
      const o = await llm({ system: prompts.stepsCode, user, schema: StepsCodeOut, effort: "medium" });
      return { need: needOf(o.need_more), finding: { ...base, headline: o.headline, facts: [{ label: "Steps today", text: o.steps_today }, { label: "Where people stall", text: o.where_people_stall }], evidence: o.evidence, where: o.where, code_refs: refs(o.code_refs, [o.headline, o.steps_today, o.where_people_stall, ...o.evidence, o.where]) } };
    }
    default: {
      const o = await llm({ system: prompts.diagnoseCode, user, schema: DiagnoseCodeOut, effort: "medium" });
      return { need: needOf(o.need_more), finding: { ...base, headline: o.cause, cause: o.cause, facts: [], evidence: o.evidence, where: o.where, confidence: o.confidence, code_refs: refs(o.code_refs, [o.cause, ...o.evidence, o.where]) } };
    }
  }
}

/** At most this many times a finding may ask to read more before it has to stand. */
export const LOOK_AGAIN_ROUNDS = 2;
/** A new look starts only this soon after the run began, so the run ends well inside the route's 300 s. */
export const LOOK_AGAIN_BEFORE_MS = 150_000;

/**
 * The finding from the code read, looking again when it says the excerpts missed the code: the ranges or terms it asks
 * for are read (lookAgain) and the finding is written again, at most LOOK_AGAIN_ROUNDS times and only while the run is
 * young. Each look is one step line ("Looked again for …") plus a line per extra read.
 */
async function findingFromCode(llm: StructuredCaller, i: IssueRow, profile: ProductProfile, snap: RepoSnapshot, first: CodeContext, issue: Parameters<typeof lookAgain>[3], startedAt: number): Promise<{ finding: DiagnosisFinding; steps: string[] }> {
  const prompts = promptsFor(profile);
  const input = findingInput(i, screenOf(i), profile).join("\n");
  let code = first;
  let r = await writeCodeFinding(llm, i, prompts, `${input}\n\n${formatContext(code)}`, code);
  const rounds: { what: string; read: { path: string; from: number; to: number }[] }[] = [];
  while (rounds.length < LOOK_AGAIN_ROUNDS && asksForMore(r.need) && Date.now() - startedAt < LOOK_AGAIN_BEFORE_MS) {
    const more = await lookAgain(snap, code, r.need, issue, profile, llm);
    if (!more) break;
    code = more.context;
    rounds.push({ what: more.what, read: more.read });
    const note = [
      `You asked to look again: the excerpts now also include ${more.what}.`,
      ...(rounds.length === LOOK_AGAIN_ROUNDS ? ["This is the last look: leave need_more empty."] : []),
    ].join(" ");
    r = await writeCodeFinding(llm, i, prompts, `${input}\n\n${note}\n\n${formatContext(code)}`, code);
  }
  // No lines named: never a confirmed find. After looking again (or still asking to), the steps say it ran out of looks.
  const exact = (r.finding.code_refs ?? []).length > 0;
  const ranOut = !exact && (rounds.length > 0 || asksForMore(r.need));
  const finding: DiagnosisFinding = exact ? r.finding : { ...r.finding, confidence: "likely" };
  return { finding, steps: codeRunSteps(first, rounds, ranOut) };
}

type OpenRepo = (project: { repo_full_name: string | null; watched_branch: string | null; org_id?: string | null }) => Promise<RepoSnapshot | null>;

/**
 * A customer app's finding and the steps the run really took. With a repository it reads the code; with none, one
 * that can't be opened (gone private or missing), or no code matching the feedback, it works from the feedback and
 * says so. A repository that can't be reached right now (GitHub down or rate-limited) fails the run, so it can be run
 * again.
 */
async function customerFinding(llm: StructuredCaller, i: IssueRow, open: OpenRepo): Promise<{ finding: DiagnosisFinding; steps: string[] }> {
  const startedAt = Date.now();
  const profile = profileOfEmbedded(i.projects, "diagnosis");
  const app = i.projects!;
  const repo = app.repo_full_name ?? null;
  if (!claudeReady()) throw new Error(repo ? NEEDS_KEY_CODE : NEEDS_KEY);
  if (!repo) return { finding: await writeFinding(llm, i), steps: feedbackRunSteps({}) };
  const snap = await open({ repo_full_name: repo, watched_branch: app.watched_branch ?? null, org_id: app.org_id ?? null });
  if (!snap) return { finding: await writeFinding(llm, i), steps: feedbackRunSteps({ unreadable: repo }) };
  const issue = { title: i.title, problem: i.problem_statement, quotes: quotesOf(i), screen: screenOf(i).label, where: whereOf(i) };
  const code = await gatherCodeContext(snap, issue, profile, llm);
  if (!code.excerpts.length) return { finding: await writeFinding(llm, i), steps: feedbackRunSteps({ searched: code.searched, terms: code.terms, partial: code.partial }) };
  return findingFromCode(llm, i, profile, snap, code, issue, startedAt);
}

export type RunDeps = {
  /** How long the demo's simulated run takes (DIAGNOSIS_RUN_MS); a customer app's run never waits unless this is set. */
  delayMs?: number; llm?: StructuredCaller; afterFinding?: (issueId: string) => Promise<void>;
  /** Opens the app's repository (openRepo); tests pass an in-memory snapshot. */
  openRepo?: OpenRepo;
};

/**
 * Plays one run, writes the finding, marks it done, then writes proposals from it. The demo waits out its simulated
 * steps and writes the finding with the model (or from the rating without a key); a customer app's run starts at once
 * and replaces its planned steps with what it did. A failed run is marked failed so it can be run again; a failure
 * writing proposals is logged without undoing the diagnosis. Never throws: it runs after the response.
 */
export async function runDiagnosis(issueId: string, d: RunDeps = {}): Promise<void> {
  // On the Claude key of the company that owns the issue (the demo and keyless beta companies use the deployment's).
  return withIssueClaude(issueId, () => runDiagnosisOnKey(issueId, d));
}

async function runDiagnosisOnKey(issueId: string, d: RunDeps): Promise<void> {
  const db = serviceDb();
  let startedAt: string | null = null;
  let finding: DiagnosisFinding;
  try {
    let i = await loadIssue(issueId);
    let diag = parseDiagnosis(i?.diagnosis);
    if (!i || diag?.status !== "running") return; // reset or finished elsewhere
    startedAt = diag.started_at;
    const demo = i.projects?.kind === "demo";
    const delay = d.delayMs ?? (demo ? DIAGNOSIS_RUN_MS : 0);
    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
      i = await loadIssue(issueId);
      diag = parseDiagnosis(i?.diagnosis);
      if (!i || diag?.status !== "running") return;
    }
    startedAt = diag.started_at;
    const llm = d.llm ?? callStructured;
    let done: Diagnosis;
    if (demo) {
      finding = await writeFinding(llm, i);
      done = { ...diag, status: "done", finished_at: new Date().toISOString(), finding };
    } else {
      const r = await customerFinding(llm, i, d.openRepo ?? openRepo);
      finding = r.finding;
      done = { ...diag, status: "done", finished_at: new Date().toISOString(), steps: r.steps, simulated: false, finding };
    }
    const { data } = await db.from("issues").update({ diagnosis: done, updated_at: done.finished_at }).eq("id", issueId).eq("diagnosis->>started_at", startedAt).select("id");
    if (!data?.length) return;
    await db.from("activity").insert({
      issue_id: issueId, kind: "diagnosis_ready",
      payload: { type: i.type, headline: finding.headline, lines: resultLines(finding), confidence: finding.confidence, ...(finding.cause ? { cause: finding.cause } : {}) },
    });
  } catch (e) {
    console.error("[diagnosis] run failed", issueId, e instanceof Error ? e.message : e);
    // What the panel and the activity show: a plain sentence, never the API's raw JSON.
    const error = friendlyLlmError(e);
    if (startedAt) {
      const failed = await db.from("issues").select("diagnosis, type").eq("id", issueId).maybeSingle();
      const cur = parseDiagnosis(failed.data?.diagnosis);
      if (cur?.status === "running" && cur.started_at === startedAt) {
        await db.from("issues").update({ diagnosis: { ...cur, status: "failed", error } }).eq("id", issueId).eq("diagnosis->>started_at", startedAt);
        await db.from("activity").insert({ issue_id: issueId, kind: "diagnosis_failed", payload: { type: failed.data?.type ?? null, error } });
      }
    }
    return;
  }
  try { await d.afterFinding?.(issueId); } catch (e) { console.error("[diagnosis] after-finding hook failed", e); }
  try {
    if (claudeReady()) await proposeOnly(issueId, 3, { diagnosis: finding });
    else {
      // No key: the proposals already on file (the demo seed) are the ones to show.
      const { count } = await db.from("solutions").select("id", { count: "exact", head: true }).eq("issue_id", issueId);
      if (count) await db.from("activity").insert({ issue_id: issueId, kind: "proposals_ready", payload: { count, from_diagnosis: true } });
    }
  } catch (e) {
    await logLaneActionFailed(issueId, "diagnosis", e);
  }
}
