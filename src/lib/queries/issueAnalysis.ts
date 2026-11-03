/* eslint-disable @typescript-eslint/no-explicit-any */
// Loads what Why it matters reads (lib/analysis): the issue's flow drawn from real screens for the panel, and a light
// reading of each issue a source was filed under for the feedback page.
import type { SupabaseClient } from "@supabase/supabase-js";
import { bestFlow, flowsWith, placeOnFlow, type AnalysisInput, type FlowLike } from "@/lib/analysis";
import { buildJourneys, type Journey, type JourneyScreen } from "@/components/flows/journey";
import { screenSources } from "@/lib/marver/sources";
import { canvasBoardUrl } from "@/lib/marver/canvas";
import { parseDiagnosis } from "@/lib/diagnosis/model";
import type { IssueType } from "@/lib/types";
import type { IssueDetail } from "./issueDetail";
import { profileOf } from "@/lib/product/profile";
import { posthogUsersByIssue } from "@/lib/posthog/reach";

export type FlowRow = FlowLike & { description: string | null };
/** The issue's best flow as real screens, which of its steps the issue is on, and its screens on no flow. */
export type Placement = {
  journey: Journey | null; affected: string[]; offFlow: JourneyScreen[];
  /** "Message thread, step 2 of 2 in Read a message". */
  place: string | null;
  /** Other flows that show one of its screens too. */
  alsoOn: number;
};

export function analysisInputFromDetail(d: IssueDetail): AnalysisInput {
  const recommended = d.solutions.find((s) => s.recommended) ?? null;
  return {
    type: d.type, breakdown: d.breakdown, ease: d.ease, peopleCount: d.people_count,
    units: d.quotes.map((q) => ({
      sentiment: q.sentiment ?? null, emotion: q.emotion ?? null, audience: q.audience ?? null, speakers: q.speakers, signals: q.signals ?? null, at: q.at, author: q.author, channel: q.channel,
      corroborators: q.corroborators, reportedCount: q.reportedCount,
    })),
    screens: d.flow,
    finding: d.diagnosis?.status === "done" && d.diagnosis.finding ? { headline: d.diagnosis.finding.headline } : null,
    recommended: recommended ? { effort: recommended.effort, risk: recommended.risk } : null,
    weights: d.project.weights,
    profile: d.project.profile,
  };
}

export async function loadFlows(db: SupabaseClient, projectId: string): Promise<FlowRow[]> {
  const { data, error } = await db.from("flows").select("board, title, description, frames, position").eq("project_id", projectId).order("position");
  if (error) throw new Error(`flows: ${error.message}`);
  return (data ?? []) as FlowRow[];
}

export async function loadPlacement(db: SupabaseClient, projectId: string, screens: { frame_id: string; title: string | null; confidence: number }[]): Promise<Placement> {
  const frameIds = screens.map((s) => s.frame_id);
  if (!frameIds.length) return { journey: null, affected: [], offFlow: [], place: null, alsoOn: 0 };
  const flows = await loadFlows(db, projectId);
  const flow = bestFlow(flows, frameIds);
  const rows = await screenSources(db, projectId, [...new Set([...(flow?.frames ?? []), ...frameIds])]);
  // No per-screen notes here: the panel is about this one issue.
  const { journeys, others } = buildJourneys(flow ? [flow] : [], rows.map((r) => ({ id: r.frame_id, frame_id: r.frame_id, title: r.title, source: r.source })), new Map(), canvasBoardUrl);
  return {
    journey: journeys[0] ?? null, affected: frameIds, offFlow: others,
    place: placeOnFlow(flows, screens)?.text ?? null, alsoOn: Math.max(0, flowsWith(flows, frameIds) - (flow ? 1 : 0)),
  };
}

export type IssueReading = { id: string; title: string; type: IssueType; input: AnalysisInput };

/** Each issue's reading for the feedback page, by id, from one query. */
export async function loadIssueReadings(db: SupabaseClient, issueIds: string[]): Promise<Map<string, IssueReading>> {
  if (!issueIds.length) return new Map();
  const { data, error } = await db.from("issues").select(`
    id, project_id, title, type, ease, people_count, score_breakdown, diagnosis,
    projects(score_weights, kind, product_profile, name),
    feedback_units(sentiment, emotion, audience, speakers, corroborators, reported_count, severity_signals, created_at, sources(author, channel, occurred_at)),
    issue_screens(confidence, screens(frame_id, title)),
    solutions(effort, risk, recommended)
  `).in("id", issueIds);
  if (error) throw new Error(`issues: ${error.message}`);
  // PostHog users, counted as the Desk counts them, per app (a source's issues all belong to one).
  const rows = (data ?? []) as any[];
  const phUsers = new Map<string, number>();
  for (const projectId of new Set(rows.map((x) => x.project_id as string))) {
    const mine = rows.filter((x) => x.project_id === projectId).map((x) => ({ id: x.id as string, frames: (x.issue_screens ?? []).map((s: any) => s.screens?.frame_id).filter(Boolean) as string[] }));
    for (const [id, n] of await posthogUsersByIssue(db, projectId, mine)) phUsers.set(id, n);
  }
  return new Map(rows.map((x) => {
    const diagnosis = parseDiagnosis(x.diagnosis);
    const recommended = (x.solutions ?? []).find((s: any) => s.recommended) ?? null;
    const input: AnalysisInput = {
      type: x.type, breakdown: x.score_breakdown, ease: x.ease, peopleCount: Number(x.people_count),
      units: (x.feedback_units ?? []).map((u: any) => ({
        sentiment: u.sentiment, emotion: u.emotion, audience: u.audience, speakers: u.speakers ?? [], signals: u.severity_signals,
        at: u.sources?.occurred_at ?? u.created_at, author: u.sources?.author ?? null, channel: u.sources?.channel ?? null,
        corroborators: u.corroborators ?? [], reportedCount: u.reported_count ?? 0,
      })),
      screens: (x.issue_screens ?? []).map((s: any) => ({ frame_id: s.screens.frame_id, title: s.screens.title, confidence: s.confidence })),
      finding: diagnosis?.status === "done" && diagnosis.finding ? { headline: diagnosis.finding.headline } : null,
      recommended: recommended ? { effort: recommended.effort, risk: recommended.risk } : null,
      weights: x.projects?.score_weights ?? null,
      profile: x.projects ? profileOf(x.projects) : null,
      phUsers30: phUsers.get(x.id) ?? 0,
    };
    return [x.id, { id: x.id, title: x.title, type: x.type, input }];
  }));
}
