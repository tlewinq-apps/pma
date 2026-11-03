/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";
import { octokit, splitRepo } from "./client";
import { env } from "@/lib/env";
import { branchName } from "@/lib/drafts/callback";
import { DRAFT_STALE_MS } from "@/lib/drafts/inflight";
import { draftBackend } from "@/lib/drafts/demo";
import { createDemoDraft } from "@/lib/drafts/demoRepo";
import { solutionText } from "@/lib/drafts/review";
import type { DraftPayloadT } from "@/lib/drafts/payload";
import { runMockDraft, type MockApp } from "@/lib/drafts/mockRunner";
import { codeMockupJob, drawsFromCode } from "@/lib/drafts/codeMockup";
import { parseDiagnosis } from "@/lib/diagnosis/model";
import { profileOfEmbedded } from "@/lib/product/profile";
import { after } from "next/server";

/** Upload slots the workflow PUTs screenshots into (6 frames x before/after fits comfortably). */
export const UPLOAD_SLOTS = 24;

/** A `dispatched` draft younger than DRAFT_STALE_MS is in flight; older ones are wedged and no longer block a retry. */
export async function hasDraftInProgress(db: SupabaseClient, issueId: string): Promise<boolean> {
  const since = new Date(Date.now() - DRAFT_STALE_MS).toISOString();
  const { count } = await db.from("drafts").select("id", { count: "exact", head: true }).eq("issue_id", issueId).eq("status", "dispatched").gte("created_at", since);
  return !!count;
}

/**
 * Creates the draft row and fires the workflow (or, with no repo + GitHub token, records a demo draft; see
 * drafts/demo.ts). A customer app's proposal with no screens is drawn from the app's code by the mock runner, whatever
 * DRAFT_BACKEND says (drafts/codeMockup.ts). Returns true only when a draft was started; on false the
 * caller (which claimed the issue as `drafting`) restores the issue status. The in-progress check looks at draft
 * rows, not issue status, so the caller's own `drafting` claim never blocks this dispatch.
 */
export async function dispatchDraft(issueId: string, solutionId: string, opts: { note?: string } = {}): Promise<boolean> {
  const db = serviceDb();
  const { data: i } = await db.from("issues").select("id,short_id,title,problem_statement,type,project_id,diagnosis,projects(repo_full_name,kind,product_profile,name,watched_branch,org_id),feedback_units(quote,sources(channel))").eq("id", issueId).single();
  const { data: s } = await db.from("solutions").select("id,title,summary,mode,target_frames").eq("id", solutionId).single();
  if (!i || !s) return false;
  const project = (i as any).projects as { repo_full_name: string | null; kind: string; product_profile: unknown; name: string; watched_branch: string | null; org_id?: string | null } | null;
  const repo = project?.repo_full_name ?? null;
  const app = { kind: project?.kind, repo_full_name: repo };

  if (await hasDraftInProgress(db, issueId)) { await db.from("activity").insert({ issue_id: issueId, kind: "draft_skipped", payload: { reason: "draft in progress" } }); return false; }
  const fromCode = drawsFromCode(app, s.target_frames);
  const backend = fromCode ? "mock" : draftBackend(app, process.env.GITHUB_TOKEN);
  if (backend === "demo") return createDemoDraft(db, i, s);
  // The mock runner writes every prompt for the app, and draws a customer proposal with no screens from the code.
  let mockApp: MockApp | null = null;
  if (backend === "mock") {
    const profile = profileOfEmbedded(project, "dispatchDraft");
    mockApp = {
      profile, projectId: i.project_id as string,
      code: fromCode ? codeMockupJob({
        project: { repo_full_name: repo!, watched_branch: project?.watched_branch ?? null, org_id: project?.org_id ?? null }, profile, diagnosis: parseDiagnosis((i as any).diagnosis),
        channels: [...new Set(((i as any).feedback_units ?? []).map((u: any) => u.sources?.channel).filter((c: unknown): c is string => typeof c === "string" && !!c.trim()))].slice(0, 3) as string[],
        title: i.title,
      }) : null,
    };
  }

  const token = randomBytes(24).toString("hex");
  const { data: draft } = await db.from("drafts").insert({ issue_id: issueId, solution_id: solutionId, mode: s.mode, callback_token: token, backend }).select("id").single();
  if (!draft) return false;
  const branch = branchName(i.short_id, i.title, draft.id);
  await db.from("drafts").update({ branch }).eq("id", draft.id);
  await db.from("issues").update({ status: "drafting" }).eq("id", issueId);

  try {
    // Signed upload URLs let the Action push PNGs straight to Storage (Vercel bodies cap near 4.5 MB).
    const upload_slots = await Promise.all(Array.from({ length: UPLOAD_SLOTS }, async (_, k) => {
      const path = `${issueId}/${draft.id}/slot-${k}.png`;
      const { data, error } = await db.storage.from("shots").createSignedUploadUrl(path);
      if (error || !data) throw new Error(`signed upload url failed: ${error?.message ?? "no data"}`);
      return { path, url: data.signedUrl };
    }));

    const payload: DraftPayloadT = {
      draft_id: draft.id, branch, mode: s.mode, target_frames: s.target_frames, issue_short_id: i.short_id,
      title: i.title, problem: i.problem_statement, type: i.type, solution: solutionText(s.title, s.summary, opts.note),
      quotes: ((i as any).feedback_units ?? []).slice(0, 5).map((u: { quote: string }) => u.quote),
      issue_url: `${env.appUrl()}/issues/${issueId}`,
      callback_url: `${env.appUrl()}/api/drafts/callback`, callback_token: token,
      upload_slots,
    };
    if (backend === "mock") {
      // The mock runner plays the Action after the response, like a repository_dispatch handing work to Actions.
      // Outside a request (seed scripts) there is no after(), so it runs inline.
      const deps = { app: mockApp ?? undefined };
      try { after(() => runMockDraft(payload, deps)); } catch { await runMockDraft(payload, deps); }
    } else {
      // GitHub caps client_payload at 10 top-level keys, so everything nests under `draft`.
      await octokit().repos.createDispatchEvent({ ...splitRepo(repo!), event_type: "pma-draft", client_payload: { draft: payload } });
    }
  } catch (e) {
    console.error("[dispatch] failed", e);
    await db.from("drafts").update({ status: "failed", callback_used_at: new Date().toISOString() }).eq("id", draft.id);
    await db.from("issues").update({ status: "new" }).eq("id", issueId);
    await db.from("activity").insert({ issue_id: issueId, kind: "draft_failed", payload: { log_url: null } });
    return false;
  }
  const approximate = backend === "mock" && project?.kind !== "demo";
  await db.from("activity").insert({ issue_id: issueId, kind: "draft_dispatched", payload: { branch, solution: s.title, ...(backend === "mock" ? { mock: true } : {}), ...(approximate ? { approximate: true } : {}) } });
  return true;
}
