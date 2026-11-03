import type { StructuredCaller } from "@/lib/llm/client";
import type { Embedder } from "@/lib/embeddings";
import type { Lane } from "@/lib/types";
import { ISSUE_TYPES } from "@/lib/types";
import { aggregateSignals, computeEase, explainImportance, peopleParts, priorityReason, routeLane, type ScoreInputs, type SignalCounts } from "@/lib/scoring";
import { signalsLabel } from "@/components/triage/format";
import { isBlockingBug } from "@/lib/alerts/rules";
import type { PipelineRepo, NewUnit, SourceRow, IssueForScoring } from "./repo";
import type { ProductProfile } from "@/lib/product/profile";
import type { Transcript } from "@/lib/transcribe/types";
import { extractUnits } from "./extract";
import { classifyUnits } from "./classify";
import { mapUnitToScreens, screenFromRoute } from "./mapScreens";
import { decideCluster } from "./cluster";
import { rateIssue } from "./rate";
import { friendlyLlmError } from "@/lib/llm/errors";

export type PipelineDeps = {
  repo: PipelineRepo; llm: StructuredCaller; onLaneEntered: (issueId: string, lane: Lane) => Promise<void>;
  /**
   * Voyage embeddings shortlist the nearest issues and screens before Claude decides. Without them (null: no
   * VOYAGE_API_KEY), Claude chooses from the open issues and all screens directly, which fits small projects.
   */
  embed: Embedder | null;
  /**
   * After clustering, before scoring and lane automation (which can take minutes), so Slack can post the card and the
   * "Filed under" reply right away. Best-effort: a throw never fails the source.
   */
  onFiled?: (sourceId: string, issueIds: string[]) => Promise<void>;
  /**
   * Once the source is done and every issue it touched is rescored, so Slack cards can show the final people count
   * and priority (onFiled posted them before scoring). Best-effort: a throw never fails the source.
   */
  onProcessed?: (sourceId: string, issueIds: string[]) => Promise<void>;
  /**
   * Turns a recording into a `Name: text` transcript (Deepgram, or a bundled sample), naming speakers in the app's own
   * words. Unset: recordings fail with a hint.
   */
  transcribe?: (src: SourceRow, profile: ProductProfile) => Promise<Transcript>;
  /** After a score is saved and logged: decides whether anyone should be alerted (src/lib/alerts). Best-effort. */
  onScored?: (issueId: string, e: ScoredEvent) => Promise<void>;
};

export type ScoredEvent = {
  prev: number | null; next: number; type: IssueForScoring["type"]; severity: number; clarity: number; signals: SignalCounts; reason: string;
  /** Whether it was a blocking bug at its last score; null when that score predates stored signals. */
  wasBlocking: boolean | null;
};

const ISSUE_TYPE_SET = new Set<string>(ISSUE_TYPES);
const MIN_CLUSTER_SIM = 0.8;
/** Screen matches below this confidence are treated as Unmapped. */
const MIN_SCREEN_CONFIDENCE = 0.5;
/** Without embeddings, Claude sees this many screens and recently updated open issues per decision. */
const MAX_SCREENS_LISTED = 80;
const MAX_ISSUES_LISTED = 60;
/** Priority moves smaller than this are noise (the LLM rating wobbles); they are saved but not logged. */
const PRIORITY_LOG_MIN = 3;

export async function processSource(deps: PipelineDeps, sourceId: string): Promise<void> {
  const { repo, llm, embed } = deps;
  if (!(await repo.claimSource(sourceId))) return;
  try {
    let src = await repo.getSource(sourceId);
    const ctx = await repo.getProjectContext(src.project_id);
    const { profile } = ctx.product;
    // Recordings arrive with no text. Transcribe once and save it before extracting, so a retry reuses the transcript.
    if (src.kind === "audio" && !src.raw_text.trim()) {
      if (!deps.transcribe) throw new Error("Recordings need DEEPGRAM_API_KEY to be transcribed");
      const t = await deps.transcribe(src, profile);
      await repo.saveTranscript(sourceId, t.text, { ...(src.metadata ?? {}), transcript: { speakers: t.speakers, durationSec: t.durationSec } });
      src = { ...src, raw_text: t.text };
    }
    // Report dates are when the feedback happened (a Slack history or last month's call is not fresh), not when it's filed.
    const occurredAt = src.occurred_at ?? new Date().toISOString();
    // Retries must be idempotent: drop units from any earlier partial run before re-inserting.
    const stale = await repo.resetSourceUnits(sourceId);
    const extracted = await extractUnits(llm, { rawText: src.raw_text, author: src.author, channel: src.channel }, profile);
    const classes = await classifyUnits(llm, extracted, { jobs: ctx.jobs, fewShots: ctx.fewShots, product: ctx.product });
    const byIndex = new Map(classes.map((c) => [c.index, c]));
    const actionable = extracted.map((u, i) => ({ u, c: byIndex.get(i), i })).filter((x) => x.c && ISSUE_TYPE_SET.has(x.c.type));
    // Relevant praise is embedded and mapped to screens too (Flows "What's working"), but never clustered into an issue.
    const praise = extracted.map((u, i) => ({ u, c: byIndex.get(i), i })).filter((x) => x.u.relevant && x.c?.type === "praise");
    const toEmbed = [...actionable, ...praise];
    const vectors: (number[] | null)[] = embed ? await embed(toEmbed.map((x) => x.u.quote), "document") : toEmbed.map(() => null);
    const vecByIndex = new Map(toEmbed.map((x, k) => [x.i, vectors[k]]));

    const rows: NewUnit[] = extracted.map((u, i) => {
      const c = byIndex.get(i);
      return {
        quote: u.quote, span_start: u.span_start, span_end: u.span_end, speakers: u.speakers, corroborators: u.corroborators,
        reported_count: u.reported_count, type: u.relevant ? (c?.type ?? "irrelevant") : "irrelevant",
        filtered_reason: u.relevant ? null : u.filtered_reason, sentiment: c?.sentiment ?? null, emotion: c?.emotion ?? null,
        audience: c?.audience ?? null, severity_signals: c?.signals ?? {}, job_code: c?.job_code ?? null, embedding: vecByIndex.get(i) ?? null,
        occurred_at: occurredAt,
      };
    });
    const inserted = await repo.insertUnits(sourceId, src.project_id, rows);

    const routed = screenFromRoute(src.route, ctx.routeMap);
    const routedScreen = routed ? await repo.getScreenByFrame(src.project_id, routed) : null;
    // Widget route first; otherwise candidates (nearest by vector, or every screen without embeddings) chosen by the
    // LLM, keeping confidence >= 0.5 (R7). Deduped by screen (one upsert row per key).
    const screensFor = async (quote: string, vec: number[] | null) => {
      if (routedScreen) return [{ screen_id: routedScreen.id, frame_id: routedScreen.frame_id, confidence: 0.95, evidence: `widget route ${src.route}` }];
      const candidates = vec ? await repo.matchScreens(src.project_id, vec, 12) : await repo.listScreens(src.project_id, MAX_SCREENS_LISTED);
      const mapped = (await mapUnitToScreens(llm, quote, candidates, profile)).filter((s) => s.confidence >= MIN_SCREEN_CONFIDENCE);
      return mapped.filter((s, k) => mapped.findIndex((o) => o.screen_id === s.screen_id) === k);
    };

    const touched = new Set<string>();
    for (const x of actionable) {
      const unitId = inserted[x.i].id;
      const vec = vecByIndex.get(x.i) ?? null;
      const screens = await screensFor(x.u.quote, vec);
      const candidates = vec ? await repo.matchIssues(src.project_id, vec, 5, MIN_CLUSTER_SIM) : await repo.listOpenIssues(src.project_id, MAX_ISSUES_LISTED);
      const decision = await decideCluster(llm, x.u.quote, x.c!.type, candidates, profile);
      const issueId = decision.action === "attach"
        ? decision.issueId
        : await repo.createIssue(src.project_id, { title: decision.title, problem_statement: decision.problemStatement, type: x.c!.type, job_code: x.c!.job_code, embedding: vec, last_reported_at: occurredAt });
      await repo.attachUnit(unitId, issueId, screens.map(({ screen_id, confidence, evidence }) => ({ screen_id, confidence, evidence })));
      // Who said it: in a recording or a thread that is the speaker, not whoever added the source.
      await repo.logActivity(issueId, "feedback_added", { quote: x.u.quote, author: x.u.speakers[0] ?? src.author, created: decision.action !== "attach", source_id: sourceId });
      touched.add(issueId);
    }
    for (const x of praise) {
      const screens = await screensFor(x.u.quote, vecByIndex.get(x.i) ?? null);
      if (screens.length) await repo.mapUnitScreens(inserted[x.i].id, screens.map(({ screen_id, confidence, evidence }) => ({ screen_id, confidence, evidence })));
    }
    try {
      await deps.onFiled?.(sourceId, [...touched]);
    } catch (e) {
      console.error("[pipeline] onFiled failed", e);
    }
    for (const issueId of touched) await rescoreIssue(deps, src.project_id, issueId);
    const rescored = [...touched];
    for (const issueId of stale) {
      if (touched.has(issueId)) continue;
      if (!(await repo.deleteIssueIfEmpty(issueId))) { await rescoreIssue(deps, src.project_id, issueId); rescored.push(issueId); }
    }
    await repo.setSourceStatus(sourceId, "done");
    try {
      await deps.onProcessed?.(sourceId, rescored);
    } catch (e) {
      console.error("[pipeline] onProcessed failed", e);
    }
  } catch (e) {
    await repo.setSourceStatus(sourceId, "failed", (e as Error).message);
  }
}

export async function rescoreIssue(deps: PipelineDeps, projectId: string, issueId: string): Promise<{ lane: Lane; changed: boolean }> {
  const { repo, llm } = deps;
  const ctx = await repo.getProjectContext(projectId);
  const issue = await repo.getIssueForScoring(issueId);
  const previousLane = issue.lane;
  if (issue.units.length === 0) return { lane: previousLane ?? "backlog", changed: false };
  const signals = aggregateSignals(issue.units);
  const prior = issue.breakdown as { severity?: number; reach?: number; clarity?: number; scope?: string } | null;
  const previous = prior && typeof prior.severity === "number" && typeof prior.reach === "number" && typeof prior.clarity === "number" && prior.scope
    ? { severity: prior.severity, reach: prior.reach, clarity: prior.clarity, scope: prior.scope } : null;
  const rating = await rateIssue(llm, issue, issue.units.map((u) => u.quote), issue.screens.map((s) => s.frame_id), signalsLabel(signals), previous, ctx.product.profile);
  const sentiments = issue.units.map((u) => u.sentiment ?? 0);
  const mean = sentiments.reduce((a, b) => a + b, 0) / Math.max(1, sentiments.length);
  const newest = Math.max(...issue.units.map((u) => Date.parse(u.occurred_at)));
  const people = peopleParts(issue.units.map((u) => ({ speakers: u.speakers, corroborators: u.corroborators, reportedCount: u.reported_count })));
  const peopleCount = people.distinct + 0.5 * people.reported;
  // Everything needed to explain the score later and to age it without another LLM call (see explainImportance).
  const inputs: ScoreInputs = {
    severity: rating.severity, reach: rating.reach, peopleCount, meanSentiment: mean, frustrated: issue.units.some((u) => u.emotion === "frustrated"),
    lastReportAt: new Date(newest).toISOString(), distinctPeople: people.distinct, reportedByOthers: people.reported,
  };
  const { total: importance, points } = explainImportance({ ...inputs, daysSinceLastReport: (Date.now() - newest) / 86_400_000 }, ctx.weights);
  const mappingConfidence = issue.screens.length ? Math.max(...issue.screens.map((s) => s.confidence)) : 0;
  const ease = computeEase({ scope: rating.scope, clarity: rating.clarity, mappingConfidence }, ctx.weights);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const lane = routeLane({ importance, ease, type: issue.type, recentReports7d: issue.units.filter((u) => Date.parse(u.occurred_at) >= weekAgo).length }, ctx.thresholds);
  await repo.saveScores(issueId, { importance, ease, lane, people_count: peopleCount, breakdown: { ...rating, peopleCount, mappingConfidence, meanSentiment: mean, inputs, points, signals } });
  const reason = priorityReason(issue.breakdown?.inputs, inputs, issue.importance);
  if (issue.importance == null || Math.abs(importance - issue.importance) >= PRIORITY_LOG_MIN) {
    await repo.logActivity(issueId, "priority_changed", { from: issue.importance, to: importance, reason });
  }
  try {
    const prevB = issue.breakdown as { inputs?: ScoreInputs; signals?: SignalCounts } | null;
    const wasBlocking = issue.importance == null ? false : prevB?.inputs && prevB.signals ? isBlockingBug(issue.type, prevB.inputs.severity, prevB.signals) : null;
    await deps.onScored?.(issueId, { prev: issue.importance, next: importance, type: issue.type, severity: rating.severity, clarity: rating.clarity, signals, reason, wasBlocking });
  } catch (e) {
    await repo.logActivity(issueId, "lane_action_failed", { lane: "alerts", error: friendlyLlmError(e) });
  }
  const changed = lane !== previousLane;
  if (changed) {
    await repo.logActivity(issueId, "lane_changed", { from: previousLane, to: lane });
    if (lane === "quick_win" || lane === "explore") {
      try {
        await deps.onLaneEntered(issueId, lane);
      } catch (e) {
        await repo.logActivity(issueId, "lane_action_failed", { lane, error: friendlyLlmError(e) });
      }
    }
  }
  return { lane, changed };
}
