/* eslint-disable @typescript-eslint/no-explicit-any */
// Demo drafter, database side. See demo.ts for the rules and the frame renderer.
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";
import { demoAdvanceDue, demoBranch, renderDemoFrame } from "./demo";

/** Records a demo draft for the chosen solution and moves the issue to `drafting`. Mirrors dispatchDraft's writes. */
export async function createDemoDraft(db: SupabaseClient, issue: { id: string; short_id: string; title: string }, solution: { id: string; title: string; mode: string }): Promise<boolean> {
  // callback_token is required by the schema; demo drafts never receive a callback, so it is consumed up front.
  const { data: draft } = await db.from("drafts").insert({
    issue_id: issue.id, solution_id: solution.id, mode: solution.mode, demo: true, backend: "demo",
    callback_token: randomBytes(24).toString("hex"), callback_used_at: new Date().toISOString(),
  }).select("id").single();
  if (!draft) return false;
  const branch = demoBranch(issue.short_id, issue.title, draft.id);
  await db.from("drafts").update({ branch }).eq("id", draft.id);
  await db.from("issues").update({ status: "drafting" }).eq("id", issue.id);
  await db.from("activity").insert({ issue_id: issue.id, kind: "draft_dispatched", payload: { branch, solution: solution.title, demo: true } });
  return true;
}

/**
 * Moves due demo drafts (dispatched, older than DEMO_DRAFT_MS) to ready with rendered frames. Runs lazily whenever
 * the hub or a workspace is read, so there are no timers to lose. Both updates are compare-and-set, so concurrent
 * readers advance a draft once.
 */
export async function advanceDemoDrafts(scope: { projectId: string } | { issueId: string }): Promise<void> {
  const db = serviceDb();
  let q = db.from("drafts").select("id, issue_id, solution_id, status, demo, created_at, issues!inner(project_id)").eq("demo", true).eq("status", "dispatched");
  q = "issueId" in scope ? q.eq("issue_id", scope.issueId) : q.eq("issues.project_id", scope.projectId);
  const { data, error } = await q;
  if (error) { console.error("[demo] load drafts failed", error.message); return; }
  const now = Date.now();
  for (const d of (data ?? []) as any[]) {
    if (!demoAdvanceDue(d, now)) continue;
    try { await advanceOne(db, d); } catch (e) { console.error("[demo] advance failed", e); }
  }
}

async function advanceOne(db: SupabaseClient, d: { id: string; issue_id: string; solution_id: string | null; issues: { project_id: string } }) {
  const { data: s } = d.solution_id ? await db.from("solutions").select("title, summary, target_frames").eq("id", d.solution_id).maybeSingle() : { data: null };
  const { data: mapped } = await db.from("issue_screens").select("position, screens(frame_id)").eq("issue_id", d.issue_id).order("position");
  const frames: string[] = s?.target_frames?.length ? s.target_frames : ((mapped ?? []) as any[]).map((m) => m.screens?.frame_id).filter(Boolean).slice(0, 2);
  const { data: screens } = await db.from("screens").select("frame_id, title, description").eq("project_id", d.issues.project_id).in("frame_id", frames.length ? frames : ["-"]);
  const byId = new Map(((screens ?? []) as any[]).map((x) => [x.frame_id, x]));
  const proposal = s ? { title: s.title, summary: s.summary } : undefined;
  const frame = (frame_id: string, side: "before" | "after") => {
    const sc = byId.get(frame_id);
    return { frame_id, url: renderDemoFrame({ title: sc?.title ?? frame_id, description: sc?.description ?? "", side, proposal }) };
  };
  const { data: moved } = await db.from("drafts").update({
    status: "ready", pr_state: "open",
    before_images: frames.map((f) => frame(f, "before")), after_images: frames.map((f) => frame(f, "after")),
  }).eq("id", d.id).eq("status", "dispatched").select("id");
  if (!moved?.length) return;
  await db.from("issues").update({ status: "draft_ready" }).eq("id", d.issue_id).eq("status", "drafting");
  await db.from("activity").insert({ issue_id: d.issue_id, kind: "draft_ready", payload: { demo: true } });
}
