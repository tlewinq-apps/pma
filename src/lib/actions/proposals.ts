import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";
import { stageOf, type Stage } from "@/components/triage/views";
import { parseDiagnosis } from "@/lib/diagnosis/model";
import { checkFirst } from "@/lib/diagnosis/checks";
import { callStructured, claudeReady, type StructuredCaller } from "@/lib/llm/client";
import { withIssueClaude } from "@/lib/llm/scope";
import { promptsFor } from "@/lib/llm/prompts";
import { profileOfEmbedded, type ProfileSource } from "@/lib/product/profile";
import { ProposalNameOut } from "@/lib/pipeline/schemas";
import { slackSyncNow } from "@/lib/slack/hooks";
import { defaultScreens, editLocked, fallbackTitle, isTextProposal, modeAfterEdit, modeFor, parseProposalInput, parseProposalText, snapshotOriginal } from "@/lib/proposals";

type Ctx = { issueId: string; type: string; frames: string[]; stage: Stage; draftSolutionId: string | null; defaultFrames: string[] };

/** What the proposal routes need to validate and lock an edit: the issue, its project's screens, its stage and the screens a one-box proposal mocks up. */
export async function proposalContext(db: SupabaseClient, issueId: string): Promise<Ctx | null> {
  const { data: issue } = await db.from("issues").select("id, project_id, status, type, diagnosis, issue_screens(position, screens(frame_id))").eq("id", issueId).maybeSingle(); // RLS-scoped
  if (!issue) return null;
  const [screens, latest, sols] = await Promise.all([
    db.from("screens").select("frame_id").eq("project_id", issue.project_id),
    db.from("drafts").select("status, solution_id, created_at").eq("issue_id", issueId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("solutions").select("recommended, target_frames").eq("issue_id", issueId),
  ]);
  const solutions = (sols.data ?? []) as { recommended: boolean; target_frames: string[] | null }[];
  const stage = stageOf({ status: issue.status, draft: latest.data ? { status: latest.data.status } : null, proposal: { count: solutions.length }, type: issue.type, diagnosis: parseDiagnosis(issue.diagnosis) });
  const flow = ((issue.issue_screens ?? []) as unknown as { position: number; screens: { frame_id: string } | null }[])
    .sort((a, b) => a.position - b.position).map((x) => x.screens?.frame_id).filter((f): f is string => !!f);
  return {
    issueId, type: issue.type, frames: (screens.data ?? []).map((s) => s.frame_id as string), stage, draftSolutionId: latest.data?.solution_id ?? null,
    defaultFrames: defaultScreens(solutions.map((x) => ({ recommended: x.recommended, target_frames: x.target_frames ?? [] })), flow),
  };
}

const waitingOnCheck = (c: Ctx) => c.stage === "needs_diagnosis" || c.stage === "diagnosing";

export async function logProposal(issueId: string, userId: string, kind: "proposal_added" | "proposal_edited" | "proposal_restored" | "proposal_removed", title: string, solutionId?: string) {
  const { error } = await serviceDb().from("activity").insert({ issue_id: issueId, user_id: userId, kind, payload: { title, ...(solutionId ? { solution_id: solutionId } : {}) } });
  if (error) console.error("[proposals] activity insert failed", error.message);
}

/** `rename` is set for a one-box proposal: run nameProposalLater with it after the response. */
export type WriteResult = { ok: true; id: string; rename?: { text: string; fallback: string } } | { ok: false; status: number; error: string };

/**
 * Write your own: a team member's proposal, ranked after the existing ones. Shared by the web route and Slack. The
 * one-box form ({ text }) is named from its first sentence and mocks up the issue's default screens; the older
 * title-and-summary form still works. Refused while the issue waits on its first step, like PMA's proposals.
 */
export async function addProposal(db: SupabaseClient, issueId: string, userId: string, body: unknown): Promise<WriteResult> {
  const ctx = await proposalContext(db, issueId);
  if (!ctx) return { ok: false, status: 404, error: "not found" };
  if (waitingOnCheck(ctx)) return { ok: false, status: 409, error: checkFirst(ctx.type) };
  let rename: { text: string; fallback: string } | undefined;
  let parsed: ReturnType<typeof parseProposalInput>;
  if (isTextProposal(body)) {
    const t = parseProposalText(body);
    if ("error" in t) return { ok: false, status: 400, error: t.error };
    const title = fallbackTitle(t.value.text);
    rename = { text: t.value.text, fallback: title };
    parsed = { value: { title, summary: t.value.text, tradeoffs: null, effort: null, risk: null, target_frames: ctx.defaultFrames } };
  } else parsed = parseProposalInput(body, ctx.frames);
  if ("error" in parsed) return { ok: false, status: 400, error: parsed.error };
  const { data: last } = await db.from("solutions").select("rank").eq("issue_id", issueId).order("rank", { ascending: false }).limit(1).maybeSingle();
  const { data: row, error } = await db.from("solutions").insert({
    issue_id: issueId, rank: (last?.rank ?? 0) + 1, ...parsed.value, mode: modeFor(parsed.value.target_frames),
    recommended: false, origin: "pm", edited_by: userId, edited_at: new Date().toISOString(),
  }).select("id").single();
  if (error || !row) return { ok: false, status: 500, error: "Couldn't save the proposal. Try again." };
  await logProposal(issueId, userId, "proposal_added", parsed.value.title, row.id);
  return { ok: true, id: row.id, ...(rename ? { rename } : {}) };
}

/**
 * Gives a one-box proposal a proper name once the response has gone: asks the model for a short title and saves it
 * only if nobody renamed it meanwhile, then refreshes Slack. Without a model key the first-sentence name stays.
 * Never throws.
 */
export async function nameProposalLater(issueId: string, solutionId: string, rename: { text: string; fallback: string }, llm: StructuredCaller = callStructured): Promise<void> {
  return withIssueClaude(issueId, () => nameOnKey(issueId, solutionId, rename, llm));
}

async function nameOnKey(issueId: string, solutionId: string, rename: { text: string; fallback: string }, llm: StructuredCaller): Promise<void> {
  if (!claudeReady()) return;
  try {
    const { data: issue, error } = await serviceDb().from("issues").select("projects(kind, product_profile, name)").eq("id", issueId).single();
    if (error || !issue) throw new Error(`loading the issue's app failed: ${error?.message ?? "not found"}`);
    const system = promptsFor(profileOfEmbedded((issue as unknown as { projects: ProfileSource | null }).projects, "nameProposal")).nameProposal;
    const o = await llm({ system, user: rename.text, schema: ProposalNameOut, effort: "low" });
    const title = o.title.trim().replace(/[.!]+$/, "").slice(0, 80);
    if (!title || title === rename.fallback) return;
    const { data } = await serviceDb().from("solutions").update({ title }).eq("id", solutionId).eq("title", rename.fallback).select("id");
    if (data?.length) await slackSyncNow(issueId);
  } catch (e) {
    console.error("[proposals] naming failed", solutionId, e instanceof Error ? e.message : e);
  }
}

const COLS = "id, title, summary, tradeoffs, effort, risk, mode, target_frames, origin, edited_at, original";

/** The proposal plus the context to validate an edit, or why it can't be edited right now. */
async function loadEditable(db: SupabaseClient, issueId: string, solutionId: string) {
  const ctx = await proposalContext(db, issueId);
  if (!ctx) return { ok: false, status: 404, error: "not found" } as const;
  const { data: s } = await db.from("solutions").select(COLS).eq("id", solutionId).eq("issue_id", issueId).maybeSingle();
  if (!s) return { ok: false, status: 404, error: "not found" } as const;
  const lock = editLocked(ctx.stage, ctx.draftSolutionId, solutionId);
  if (lock) return { ok: false, status: 409, error: lock } as const;
  return { ok: true, ctx, s } as const;
}

/** Edit a proposal, or `{ restore: true }` to put PMA's version back. The first edit keeps that version. */
export async function editProposal(db: SupabaseClient, issueId: string, solutionId: string, userId: string, body: unknown): Promise<WriteResult> {
  const r = await loadEditable(db, issueId, solutionId);
  if (!r.ok) return r;
  const { ctx, s } = r;
  let patch: Record<string, unknown>, kind: "proposal_edited" | "proposal_restored", title: string;
  let rename: { text: string; fallback: string } | undefined;
  if (body && typeof body === "object" && (body as { restore?: unknown }).restore === true) {
    const o = s.original as Record<string, unknown> | null;
    if (s.origin !== "ai" || !o) return { ok: false, status: 409, error: "There's no PMA version to restore" };
    patch = { title: o.title, summary: o.summary, tradeoffs: o.tradeoffs, effort: o.effort, risk: o.risk, mode: o.mode, target_frames: o.target_frames, edited_by: null, edited_at: null, original: null };
    kind = "proposal_restored"; title = String(o.title);
  } else if (isTextProposal(body)) {
    // The one box edits the words; the name follows them, and the screens, size and risk stay as they were.
    const t = parseProposalText(body);
    if ("error" in t) return { ok: false, status: 400, error: t.error };
    title = fallbackTitle(t.value.text);
    rename = { text: t.value.text, fallback: title };
    patch = { title, summary: t.value.text, edited_by: userId, edited_at: new Date().toISOString(), original: s.origin === "ai" && !s.original ? snapshotOriginal(s) : s.original };
    kind = "proposal_edited";
  } else {
    const parsed = parseProposalInput(body, ctx.frames);
    if ("error" in parsed) return { ok: false, status: 400, error: parsed.error };
    patch = {
      ...parsed.value, mode: modeAfterEdit(s, parsed.value.target_frames), edited_by: userId, edited_at: new Date().toISOString(),
      original: s.origin === "ai" && !s.original ? snapshotOriginal(s) : s.original,
    };
    kind = "proposal_edited"; title = parsed.value.title;
  }
  const { data, error } = await db.from("solutions").update(patch).eq("id", solutionId).select("id");
  if (error || !data?.length) return { ok: false, status: 500, error: "Couldn't save the proposal. Try again." };
  await logProposal(issueId, userId, kind, title, solutionId);
  return { ok: true, id: solutionId, ...(rename ? { rename } : {}) };
}

/** Remove a proposal your team wrote. PMA's own proposals stay (edit or restore them instead). */
export async function removeProposal(db: SupabaseClient, issueId: string, solutionId: string, userId: string): Promise<WriteResult> {
  const r = await loadEditable(db, issueId, solutionId);
  if (!r.ok) return r;
  if (r.s.origin !== "pm") return { ok: false, status: 409, error: "Only proposals your team wrote can be removed" };
  const { data, error } = await db.from("solutions").delete().eq("id", solutionId).select("id");
  if (error || !data?.length) return { ok: false, status: 500, error: "Couldn't remove the proposal. Try again." };
  await logProposal(issueId, userId, "proposal_removed", r.s.title, solutionId);
  return { ok: true, id: solutionId };
}
