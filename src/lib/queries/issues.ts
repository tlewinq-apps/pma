/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";
import { userDb } from "@/lib/db/server";
import { SCOPE_VALUE, type IssueStatus, type IssueType, type Lane, type Scope } from "@/lib/types";
import type { Emotion } from "@/components/triage/format";
import { dominantEmotion } from "@/components/triage/views";
import { parseDiagnosis, type Diagnosis } from "@/lib/diagnosis/model";
import { reportStats, scoreUrgency } from "@/lib/urgency";
import { posthogUsersByIssue } from "@/lib/posthog/reach";

export type IssueCardData = {
  id: string; short_id: string; title: string; type: IssueType; lane: Lane | null; importance: number | null; ease: number | null;
  people_count: number; status: IssueStatus; owner: { id: string; email: string } | null; flow: string | null; mean_sentiment: number;
  emotion: Emotion | null; scope: Scope | null;
  /** Severity 1-5 from the rating, shown as the impact word (Blocker, Annoyance, ...). */
  severity: number | null;
  /** Urgency out of 10, the same number as Why it matters (lib/urgency); null until the issue is rated. */
  urgency: number | null;
  /** The same before rounding, so the Urgent rail can order issues that show the same number. */
  urgency_raw: number | null;
  diagnosis: Diagnosis | null;
  seen_by: string[]; top_quotes: { quote: string; author: string | null; channel: string | null; at: string }[];
  /** count of solutions; title of the recommended one (or the first). */
  proposal: { count: number; title: string | null };
  draft: { status: string; solution_title: string | null; demo: boolean; before: string | null; after: string | null } | null;
  job_code: string | null; audiences: string[];
  /** The latest activity of any kind (or when the issue was last touched), and when it was approved and shipped. */
  last_activity_at: string; approved_at: string | null;
};

function flowLabel(screens: any[]): string | null {
  const first = screens[0]?.screens, last = screens.at(-1)?.screens;
  const scene = first?.scene, end = last?.title ?? last?.frame_id;
  return scene && end ? `${scene} › ${end}` : null;
}

/**
 * The app's open issues as the Desk shows them. Signed in, RLS keeps the reader in their company. An API key's app
 * (lib/api/auth: the MCP server) passes the service client: the query is already scoped to the app, and member emails
 * come from service_member_emails, the service role's copy of project_member_emails.
 */
export async function listIssues(projectId: string, now = Date.now(), service?: SupabaseClient): Promise<IssueCardData[]> {
  const db = service ?? await userDb();
  const { data, error } = await db.from("issues").select(`
    id, short_id, title, type, lane, importance, ease, people_count, status, owner_id, score_breakdown, diagnosis, updated_at,
    jobs(code),
    issue_screens(position, screens(scene, title, frame_id)),
    feedback_units(quote, sentiment, emotion, audience, speakers, corroborators, reported_count, created_at, sources(author, channel, occurred_at)),
    solutions(id, title, recommended, rank),
    drafts(status, solution_id, demo, before_images, after_images, created_at),
    activity(kind, user_id, at)
  `).eq("project_id", projectId).neq("status", "dismissed");
  if (error) throw new Error(error.message);
  const emails = service ? "service_member_emails" : "project_member_emails";
  const { data: people, error: peopleError } = await db.rpc(emails, { p_project: projectId });
  if (peopleError) throw new Error(`${emails}: ${peopleError.message}`);
  const emailById = new Map(((people ?? []) as { user_id: string; email: string }[]).map((p) => [p.user_id, p.email]));
  // PostHog users lift urgency as they do in Why it matters (lib/posthog/reach); an app without PostHog data reads none.
  const phUsers = await posthogUsersByIssue(db, projectId, (data ?? []).map((i: any) => ({ id: i.id, frames: (i.issue_screens ?? []).map((s: any) => s.screens?.frame_id).filter(Boolean) })));
  return (data ?? []).map((i: any) => {
    const screens = [...(i.issue_screens ?? [])].sort((a: any, b: any) => a.position - b.position);
    const units = i.feedback_units ?? [];
    const draft = [...(i.drafts ?? [])].sort((a: any, b: any) => b.created_at.localeCompare(a.created_at))[0];
    const sols = [...(i.solutions ?? [])].sort((a: any, b: any) => a.rank - b.rank);
    const rec = sols.find((s: any) => s.recommended) ?? sols[0];
    const scope = i.score_breakdown?.scope;
    const mean = units.reduce((s: number, u: any) => s + (u.sentiment ?? 0), 0) / Math.max(1, units.length);
    // Urgency reads what Why it matters reads: the scored severity and the pieces, by when each happened.
    const b = i.score_breakdown;
    const severity = b?.inputs?.severity ?? b?.severity;
    const pieces = units.map((u: any) => ({ at: u.sources?.occurred_at ?? u.created_at, speakers: u.speakers ?? [], corroborators: u.corroborators ?? [], reportedCount: u.reported_count ?? 0 }));
    const urgency = typeof severity === "number" ? scoreUrgency(severity, reportStats(pieces, now, phUsers.get(i.id) ?? 0), now) : null;
    const viewers = [...new Set((i.activity ?? []).filter((a: any) => a.kind === "viewed" && a.user_id).map((a: any) => emailById.get(a.user_id)).filter(Boolean))] as string[];
    return {
      id: i.id, short_id: i.short_id, title: i.title, type: i.type, lane: i.lane, importance: i.importance, ease: i.ease,
      people_count: Number(i.people_count), status: i.status, owner: i.owner_id ? { id: i.owner_id, email: emailById.get(i.owner_id) ?? "?" } : null,
      flow: flowLabel(screens),
      mean_sentiment: mean, emotion: dominantEmotion(units.map((u: any) => u.emotion), mean),
      scope: scope && scope in SCOPE_VALUE ? scope : null,
      severity: typeof i.score_breakdown?.severity === "number" ? i.score_breakdown.severity : null,
      urgency: urgency?.score ?? null, urgency_raw: urgency?.raw ?? null,
      diagnosis: parseDiagnosis(i.diagnosis),
      proposal: { count: sols.length, title: rec?.title ?? null },
      seen_by: viewers,
      top_quotes: units.slice(0, 2).map((u: any) => ({ quote: u.quote, author: u.sources?.author ?? null, channel: u.sources?.channel ?? null, at: u.sources?.occurred_at ?? u.created_at })),
      draft: draft ? {
        status: draft.status, solution_title: sols.find((s: any) => s.id === draft.solution_id)?.title ?? null, demo: !!draft.demo,
        before: draft.before_images?.[0]?.url ?? null, after: draft.after_images?.[0]?.url ?? null,
      } : null,
      job_code: i.jobs?.code ?? null, audiences: [...new Set(units.map((u: any) => u.audience).filter(Boolean))] as string[],
      last_activity_at: (i.activity ?? []).filter((a: any) => a.kind !== "viewed").reduce((m: string, a: any) => (a.at > m ? a.at : m), i.updated_at),
      approved_at: (i.activity ?? []).filter((a: any) => a.kind === "approved").reduce((m: string | null, a: any) => (!m || a.at > m ? a.at : m), null),
    };
  });
}
