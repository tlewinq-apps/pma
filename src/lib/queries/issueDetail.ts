/* eslint-disable @typescript-eslint/no-explicit-any */
import { userDb } from "@/lib/db/server";
import { ISSUE_TYPES, type IssueType } from "@/lib/types";
import type { Emotion } from "@/components/triage/format";
import { dominantEmotion } from "@/components/triage/views";
import type { DetailQuote } from "./issueHelpers";
import type { FactorKey, ScoreInputs, SignalCounts } from "@/lib/scoring";
import type { Weights } from "@/lib/types";
import type { Followups } from "@/lib/followups";
import { reportersToTell } from "@/lib/reporters";
import { parseDiagnosis, type Diagnosis } from "@/lib/diagnosis/model";
import { parseDraftFlow } from "@/lib/marver/flowModel";
import { canvasBoardUrl } from "@/lib/marver/canvas";
import { screenSources } from "@/lib/marver/sources";
import { buildFlowView, type FlowView } from "./flowView";
import { GENERIC_PROFILE, profileOf, type ProductProfile } from "@/lib/product/profile";
import { NO_CAPS, savedBuildBranch, savedBuildMode, type BuildCaps, type BuildMode, type BuildView, type PullRequestLink } from "@/lib/handoff/build";

export { groupQuotesBySource, marverBranchUrl, describeActivity } from "./issueHelpers";

export type IssueDetail = {
  /** The app (projects row) the issue belongs to. */
  project_id: string;
  id: string; short_id: string; title: string; problem_statement: string; type: IssueType; lane: string | null; status: string;
  importance: number | null; ease: number | null; people_count: number; decision: string | null;
  breakdown: {
    severity: number; clarity: number; scope: string; reach: number; rationale: Record<string, string>; mappingConfidence: number; peopleCount: number;
    /** One line from the rating: the most likely cause and what is still unknown. Absent on older ratings. */
    suspected_cause?: string;
    /** Present on issues scored since the priority explanation shipped (and on the demo seed). */
    inputs?: ScoreInputs; points?: Record<FactorKey, number>; signals?: SignalCounts;
  } | null;
  owner_id: string | null; owner_email: string | null;
  /** `profile`: what the app is (profileOf), for the audience words on screen. `kind`: "demo" for the Celeste demo
   *  app (its first step is simulated), else the app reads its own repository. */
  project: { kind: string; repo_full_name: string | null; design_path: string | null; weights: Weights | null; profile: ProductProfile;
    /** The company's saved answer to "How should this be built?" for this app (projects.settings.build), or null,
     *  and its branch for "Add to an existing branch". */
    build_default: BuildMode | null; build_branch: string | null;
    /** What the company's GitHub connection allows (Build it). The query can't read connections, so it is NO_CAPS
     *  here and the issue page fills it in from lib/build/start.ts buildCaps. */
    build_caps: BuildCaps };
  job: { code: string; title: string; current_flow_md: string | null } | null;
  quotes: DetailQuote[]; emotion: Emotion | null; audiences: string[];
  flow: { frame_id: string; title: string | null; confidence: number; evidence: string | null }[];
  solutions: {
    id: string; rank: number; title: string; summary: string; tradeoffs: string | null; effort: string | null; risk: string | null; recommended: boolean; mode: string; target_frames: string[];
    origin: "ai" | "pm"; edited_at: string | null; edited_by_email: string | null; has_original: boolean;
  }[];
  /** Every screen of the project; `suggested` = in this issue's flow or targeted by one of its proposals. */
  screens: { frame_id: string; title: string; suggested: boolean }[];
  draft: { id: string; status: string; solution_id: string | null; demo: boolean; backend: string; pr_url: string | null; pr_number: number | null; pr_state: string | null; branch: string | null; before: { frame_id: string; url: string }[]; after: { frame_id: string; url: string }[]; marver_paths: string[]; log_url: string | null; created_at: string;
    /** The Marver frames the drafter wrote (the end-result screen), with the one line on what changed. */
    frames: { frame_id: string; path: string; changed: string | null }[];
    /** Create full flow: today's flow over the proposed one, ready to draw. */
    flow: FlowView | null;
    /** The mock-up's board on the local Marver canvas (MARVER_CANVAS_URL), or null. */
    canvasUrl: string | null;
  } | null;
  activity: { id: number; kind: string; user_id: string | null; user_email: string | null; payload: Record<string, unknown>; at: string }[];
  /** Drafted when clarity is low; asked in the reporters' Slack threads. */
  followups: Followups | null;
  /** Bugs only: the diagnostics run that comes before any proposal (lib/diagnosis). */
  diagnosis: Diagnosis | null;
  /** Who raised it: Slack people can be answered in their thread, everyone else is listed by name. */
  reporters: { slack: string[]; others: { name: string; where: string }[] };
  /** Code pull requests linked to the issue (migration 0040), newest first. Its merge ships a customer issue. */
  pull_requests: PullRequestLink[];
  /** The latest Build it attempt (migration 0043), or null. */
  build: BuildView | null;
};

/** Suggested screens first (in flow order), then the rest of the project's screens. */
function suggestScreens(all: { frame_id: string; title: string | null }[], suggested: string[]): { frame_id: string; title: string; suggested: boolean }[] {
  const order = [...new Set(suggested)];
  const byId = new Map(all.map((s) => [s.frame_id, s.title ?? s.frame_id]));
  const first = order.filter((f) => byId.has(f)).map((f) => ({ frame_id: f, title: byId.get(f)!, suggested: true }));
  const rest = all.filter((s) => !order.includes(s.frame_id)).map((s) => ({ frame_id: s.frame_id, title: s.title ?? s.frame_id, suggested: false }));
  return [...first, ...rest];
}

export function parseIssuePatch(body: unknown): { assign?: "me" | null; type?: IssueType; decision?: string; dismiss?: boolean; title?: string } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>; const out: Record<string, unknown> = {};
  if ("assign" in b) { if (b.assign !== "me" && b.assign !== null) return { error: "invalid assign" }; out.assign = b.assign; }
  if ("type" in b) { if (!ISSUE_TYPES.includes(b.type as IssueType)) return { error: "invalid type" }; out.type = b.type; }
  if ("decision" in b) { if (typeof b.decision !== "string") return { error: "invalid decision" }; if (b.decision.length > 5000) return { error: "decision too long" }; out.decision = b.decision; }
  if ("title" in b) { const t = typeof b.title === "string" ? b.title.trim() : ""; if (t.length < 1 || t.length > 80) return { error: "invalid title" }; out.title = t; }
  if ("dismiss" in b) out.dismiss = b.dismiss === true;
  return out;
}

export async function getIssueDetail(id: string): Promise<IssueDetail | null> {
  const db = await userDb();
  const { data: i, error } = await db.from("issues").select(`
    id, short_id, title, problem_statement, type, lane, status, importance, ease, people_count, decision, score_breakdown, owner_id, project_id, followups, diagnosis,
    projects(repo_full_name, design_path, score_weights, kind, product_profile, name, settings),
    jobs(code, title, current_flow_md),
    feedback_units(id, quote, speakers, corroborators, reported_count, source_id, sentiment, emotion, audience, severity_signals, created_at, sources(author, channel, occurred_at, kind, metadata)),
    issue_screens(position, confidence, evidence, screens(frame_id, title)),
    solutions(id, rank, title, summary, tradeoffs, effort, risk, recommended, mode, target_frames, origin, edited_by, edited_at, original),
    drafts(id, status, solution_id, demo, backend, pr_url, pr_number, pr_state, branch, before_images, after_images, marver_paths, log_url, created_at, frames, flow),
    activity(id, kind, user_id, payload, at),
    pull_request_links(id, url, repo, number, state, preview_url, linked_by, created_at),
    builds(id, mode, status, steps, files, error, pr_url, pr_number, head_branch, base_branch, created_at, updated_at)
  `).eq("id", id).single();
  if (error && error.code !== "PGRST116") throw new Error(error.message);
  if (!i) return null;
  const { data: people, error: peopleError } = await db.rpc("project_member_emails", { p_project: (i as any).project_id });
  if (peopleError) throw new Error(`project_member_emails: ${peopleError.message}`);
  const emailById = new Map(((people ?? []) as { user_id: string; email: string }[]).map((p) => [p.user_id, p.email]));
  const x = i as any;
  const { data: screenRows, error: screenError } = await db.from("screens").select("frame_id, title").eq("project_id", x.project_id).order("frame_id");
  if (screenError) throw new Error(`screens: ${screenError.message}`);
  const draft = [...(x.drafts ?? [])].sort((a: any, b: any) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  const flow = parseDraftFlow(draft?.flow);
  let flowView: FlowView | null = null;
  if (flow) {
    const ids = [...new Set([...flow.current, ...flow.steps.map((s) => s.current).filter((c): c is string => !!c)])];
    const screens = new Map((await screenSources(db, x.project_id, ids)).map((r) => [r.frame_id, r]));
    flowView = buildFlowView(flow, screens, Date.now(), canvasBoardUrl(flow.canvas_board));
  }
  return {
    project_id: x.project_id,
    id: x.id, short_id: x.short_id, title: x.title, problem_statement: x.problem_statement, type: x.type, lane: x.lane, status: x.status,
    importance: x.importance, ease: x.ease, people_count: Number(x.people_count), decision: x.decision, breakdown: x.score_breakdown, owner_id: x.owner_id, owner_email: x.owner_id ? emailById.get(x.owner_id) ?? null : null,
    project: { kind: x.projects?.kind ?? "customer", repo_full_name: x.projects?.repo_full_name ?? null, design_path: x.projects?.design_path ?? null, weights: x.projects?.score_weights ?? null, profile: x.projects ? profileOf(x.projects) : GENERIC_PROFILE,
      build_default: savedBuildMode(x.projects?.settings), build_branch: savedBuildBranch(x.projects?.settings), build_caps: NO_CAPS },
    job: x.jobs ?? null,
    emotion: dominantEmotion((x.feedback_units ?? []).map((u: any) => u.emotion), (x.feedback_units ?? []).reduce((s: number, u: any) => s + (u.sentiment ?? 0), 0) / Math.max(1, (x.feedback_units ?? []).length)),
    audiences: [...new Set((x.feedback_units ?? []).map((u: any) => u.audience).filter(Boolean))] as string[],
    quotes: (x.feedback_units ?? []).map((u: any) => ({ id: u.id, quote: u.quote, sentiment: u.sentiment ?? 0, speakers: u.speakers, source_id: u.source_id, author: u.sources?.author ?? null, channel: u.sources?.channel ?? null, at: u.sources?.occurred_at ?? u.created_at, emotion: u.emotion ?? null, audience: u.audience ?? null, signals: u.severity_signals ?? null, corroborators: u.corroborators ?? [], reportedCount: u.reported_count ?? 0 })),
    flow: [...(x.issue_screens ?? [])].sort((a: any, b: any) => a.position - b.position).map((s: any) => ({ frame_id: s.screens.frame_id, title: s.screens.title, confidence: s.confidence, evidence: s.evidence ?? null })),
    solutions: [...(x.solutions ?? [])].sort((a: any, b: any) => a.rank - b.rank).map((s: any) => ({
      id: s.id, rank: s.rank, title: s.title, summary: s.summary, tradeoffs: s.tradeoffs, effort: s.effort, risk: s.risk, recommended: s.recommended, mode: s.mode,
      target_frames: s.target_frames ?? [], origin: s.origin ?? "ai", edited_at: s.edited_at, edited_by_email: s.edited_by ? emailById.get(s.edited_by) ?? null : null, has_original: !!s.original,
    })),
    screens: suggestScreens(screenRows ?? [], [
      ...[...(x.issue_screens ?? [])].sort((a: any, b: any) => a.position - b.position).map((s: any) => s.screens.frame_id),
      ...(x.solutions ?? []).flatMap((s: any) => s.target_frames ?? []),
    ]),
    draft: draft && { id: draft.id, status: draft.status, solution_id: draft.solution_id, demo: !!draft.demo, backend: draft.backend ?? "github", pr_url: draft.pr_url, pr_number: draft.pr_number, pr_state: draft.pr_state, branch: draft.branch, before: draft.before_images, after: draft.after_images, marver_paths: draft.marver_paths, log_url: draft.log_url, created_at: draft.created_at,
      frames: ((draft.frames ?? []) as { frame_id: string; path: string; changed?: string }[]).map((f) => ({ frame_id: f.frame_id, path: f.path, changed: f.changed ?? null })),
      // Only a Marver frame (it has a path) is on the canvas; an approximate mock-up's entry only says what changed.
      flow: flowView, canvasUrl: (draft.frames ?? []).some((f: { path?: string }) => !!f.path) ? canvasBoardUrl(`pma-${String(x.short_id).toLowerCase()}`) : null },
    activity: [...(x.activity ?? [])].sort((a: any, b: any) => b.at.localeCompare(a.at)).map((a: any) => ({ id: Number(a.id), kind: a.kind, user_id: a.user_id ?? null, user_email: a.user_id ? emailById.get(a.user_id) ?? null : null, payload: a.payload, at: a.at })),
    followups: x.followups ?? null,
    diagnosis: parseDiagnosis(x.diagnosis),
    reporters: (() => {
      const r = reportersToTell((x.feedback_units ?? []).filter((u: any) => u.sources).map((u: any) => ({ source_id: u.source_id, ...u.sources })));
      return { slack: [...new Set(r.slack.map((p) => p.name))], others: r.others };
    })(),
    pull_requests: [...(x.pull_request_links ?? [])].sort((a: any, b: any) => b.created_at.localeCompare(a.created_at)).map((l: any) => ({
      id: l.id, url: l.url, repo: l.repo, number: Number(l.number), state: l.state, preview_url: l.preview_url ?? null,
      linked_by_email: l.linked_by ? emailById.get(l.linked_by) ?? null : null, created_at: l.created_at,
    })),
    build: (() => {
      const b = [...(x.builds ?? [])].sort((p: any, q: any) => q.created_at.localeCompare(p.created_at))[0];
      if (!b) return null;
      const strs = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
      return { id: b.id, mode: b.mode, status: b.status, steps: strs(b.steps), files: strs(b.files), error: b.error ?? null, pr_url: b.pr_url ?? null,
        pr_number: b.pr_number ?? null, head_branch: b.head_branch ?? null, base_branch: b.base_branch ?? null, created_at: b.created_at, updated_at: b.updated_at } as BuildView;
    })(),
  };
}
