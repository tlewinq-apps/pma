// The mock runner: plays the GitHub Action (github-template/pma-draft.yml) inside the app, so the Marver
// connection can be exercised without a design repo or GitHub. It receives the real dispatch payload, has the design
// agent (Claude) edit the Marver frame that best shows the finished change, draws the current and proposed frames,
// PUTs the PNGs to the signed upload slots and POSTs the real callback with the edited frame's code, so the draft goes
// through the same token, slot and status checks as a real one. Only GitHub and Marver's own screenshot are simulated;
// with MARVER_CANVAS_DIR set, the proposed frame is also written into the local Marver canvas.
// A customer app with no design canvas has no frame to edit: its proposal is drawn from its code instead (CodeMockup):
// the runner re-reads the lines the first step named, the design agent draws today's screen from them and then the
// proposal over it, and the callback carries the two shots only, with no pull request number and no Marver files.
import { serviceDb } from "@/lib/db/server";
import { env } from "@/lib/env";
import { callStructured, ownKeyWording, withAppClaude, type StructuredCaller } from "@/lib/llm/client";
import { draftEndResult, frameFromCode, PHONE_FRAME, type Brief, type DraftedFrame, type FrameSize, type SourceFrame } from "@/lib/marver/agent";
import { tryParseFrame, parseFrame, type ParsedFrame } from "@/lib/marver/frame";
import { screenSources } from "@/lib/marver/sources";
import { writeCanvasBoard } from "@/lib/marver/canvas";
import { openRepo as openRepository, type RepoSnapshot } from "@/lib/repo/snapshot";
import { excerptsAround } from "@/lib/repo/context";
import type { ProductProfile } from "@/lib/product/profile";
import type { CallbackBody, Shot } from "./callback";
import { MOCKUP_BUDGET_MS, MOCKUP_TOO_LONG, NEEDS_CODE_TO_DRAW, REPAIR_MIN_MS, type CodeMockup } from "./codeMockup";
import { demoFrameModel } from "./demo";
import type { DraftPayloadT } from "./payload";
import { friendlyLlmError } from "@/lib/llm/errors";

/** How long the mock waits before "starting Marver", so the Drafting state is visible. */
export const MOCK_DELAY_MS = 1_500;
const MAX_FRAMES = 6;
/** The design agent sees at most this many of the proposal's screens and picks the one that shows the end result. */
const AGENT_FRAMES = 3;

export const mockPrUrl = (appUrl: string, draftId: string) => `${appUrl.replace(/\/+$/, "")}/mock/pr/${draftId}`;
/** A stable, plausible PR number for the mock pull request page. */
const prNumber = (draftId: string) => 100 + (parseInt(draftId.replace(/-/g, "").slice(0, 6), 16) % 900);

/** The payload's solution text is "Title: summary" plus an optional reviewer note (drafts/review.ts solutionText). */
export function proposalOf(solution: string): { title: string; summary: string } {
  const flat = solution.replace(/\s*\n+\s*/g, " ").trim();
  const at = flat.indexOf(": ");
  return at < 0 ? { title: flat, summary: "" } : { title: flat.slice(0, at), summary: flat.slice(at + 2) };
}

export type DraftedFile = NonNullable<CallbackBody["frames"]>[number];

/**
 * The ready callback. An approximate mock-up (drawn from an app's code) has no pull request: its pr_url is the mock page
 * the callback check expects, but it carries no pr_number, no Marver files and no frame code, only the design agent's
 * one line on what changed (`changed`), which Copy task quotes, and the proposed frame's code (`frame_source`), which
 * Download task packs as a layout reference.
 */
export function buildMockCallback(p: DraftPayloadT, shots: { before: Shot[]; after: Shot[] }, appUrl: string, frames: DraftedFile[] = [], o: { approximate?: boolean; changed?: string; source?: string } = {}): CallbackBody {
  if (o.approximate) return { draft_id: p.draft_id, token: p.callback_token, status: "ready", pr_url: mockPrUrl(appUrl, p.draft_id), before: shots.before, after: shots.after, marver_paths: [], ...(o.changed ? { changed: o.changed } : {}), ...(o.source ? { frame_source: o.source } : {}) };
  return {
    draft_id: p.draft_id, token: p.callback_token, status: "ready", pr_url: mockPrUrl(appUrl, p.draft_id), pr_number: prNumber(p.draft_id),
    before: shots.before, after: shots.after,
    marver_paths: frames.length ? frames.map((f) => f.path) : p.target_frames.map((f) => `design/scenes/${f}.tsx`),
    ...(frames.length ? { frames } : {}),
  };
}

async function postCallback(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`callback ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

type Screen = { frame_id: string; title: string | null; description: string | null; source?: string | null };

async function loadScreens(draftId: string, frames: string[]): Promise<Screen[]> {
  const db = serviceDb();
  const { data: draft } = await db.from("drafts").select("issue_id, issues(project_id)").eq("id", draftId).single();
  const projectId = (draft as { issues?: { project_id?: string } } | null)?.issues?.project_id;
  return projectId ? screenSources(db, projectId, frames) : [];
}

/**
 * When the runner can't reach APP_URL/api/drafts/callback at all (a dropped tunnel, deployment protection), it fails
 * the draft itself, the way the callback route would, so the issue doesn't sit in Drafting until it goes stale.
 */
async function markFailed(draftId: string, error: string): Promise<void> {
  const db = serviceDb();
  const { data: claimed } = await db.from("drafts").update({ status: "failed", callback_used_at: new Date().toISOString() }).eq("id", draftId).is("callback_used_at", null).select("issue_id");
  const issueId = claimed?.[0]?.issue_id as string | undefined;
  if (!issueId) return; // the callback did land after all
  await db.from("issues").update({ status: "new" }).eq("id", issueId);
  await db.from("activity").insert({ issue_id: issueId, kind: "draft_failed", payload: { log_url: null, error: `Mock runner couldn't reach the callback: ${error}` } });
}

/** The app a draft is for, from the dispatcher: its profile (every prompt is written for it), for a customer proposal
 *  with no screens how to draw it from the code, and its id, so the drawing runs on its company's Claude key. */
export type MockApp = { profile: ProductProfile; code: CodeMockup | null; projectId?: string };

export type MockRunnerDeps = {
  delayMs?: number;
  post?: (url: string, body: unknown) => Promise<void>;
  markFailed?: (draftId: string, error: string) => Promise<void>;
  loadScreens?: (draftId: string, frames: string[]) => Promise<Screen[]>;
  /** The app (dispatchDraft passes it). Without it the default designer can't write its prompt and the schematic is drawn. */
  app?: MockApp;
  /** The design agent; defaults to Claude. Throwing falls back to the schematic, so a draft never breaks mid-demo. */
  designer?: (brief: Brief, frames: SourceFrame[]) => Promise<DraftedFrame>;
  /** The model behind a mock-up drawn from code; defaults to Claude. */
  llm?: StructuredCaller;
  /** Opens the app's repository for a mock-up drawn from code; defaults to lib/repo/snapshot. */
  openRepo?: (project: { repo_full_name: string; watched_branch: string | null; org_id?: string | null }) => Promise<RepoSnapshot | null>;
  /** Draws a frame as PNG bytes; defaults to PMA's renderer (lib/marver/shot). */
  shoot?: (frame: ParsedFrame, o: { marks?: boolean; size?: FrameSize }) => Promise<Buffer>;
};

const briefOf = (p: DraftPayloadT): Brief => ({ title: p.title, type: p.type, problem: p.problem, proposal: proposalOf(p.solution), quotes: p.quotes });

/**
 * Today's screen and the proposal over it, for an app without a canvas: the lines the first step named are read again
 * (±80 lines each), the design agent draws today's screen from them, then edits it into the proposal. Throws with a
 * plain sentence when there is nothing to draw from; the caller fails the draft with it (there is no schematic to fall
 * back to, since there are no screens). A frame the agent got wrong is asked for again only with REPAIR_MIN_MS left
 * before `deadline`. A repository name can end in "." (acme/Closet.), so no sentence ends on one.
 */
async function drawFromCode(p: DraftPayloadT, app: MockApp & { code: CodeMockup }, d: MockRunnerDeps, deadline: number): Promise<{ today: SourceFrame; todayFrame: ParsedFrame; end: DraftedFrame }> {
  const job = app.code;
  if (!job.spans.length) throw new Error(NEEDS_CODE_TO_DRAW);
  const snap = await (d.openRepo ?? openRepository)({ repo_full_name: job.repo_full_name, watched_branch: job.watched_branch, org_id: job.org_id ?? null });
  if (!snap) throw new Error(`PMA couldn't open ${job.repo_full_name} to draw this screen.`);
  const excerpts = excerptsAround(snap, job.spans);
  if (!excerpts.length) throw new Error(`PMA read ${job.repo_full_name} but couldn't find the code the first step read. Run the first step again.`);
  const llm = d.llm ?? callStructured;
  const canRetry = () => deadline - Date.now() >= REPAIR_MIN_MS;
  const today = await frameFromCode(llm, app.profile, excerpts, job.screen, { size: job.size, context: job.context, canRetry });
  const end = await draftEndResult(llm, briefOf(p), [today], { profile: app.profile, size: job.size }, { canRetry });
  return { today, todayFrame: parseFrame(today.source), end };
}

/**
 * Runs `work` until `deadline`. Past it, rejects with MOCKUP_TOO_LONG (the caller posts the failed callback, so the panel
 * offers Retry), and `work` sees expired() turn true so it uploads and posts nothing more.
 */
export async function withDeadline<T>(work: (expired: () => boolean) => Promise<T>, deadline: number): Promise<T> {
  let late = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { late = true; reject(new Error(MOCKUP_TOO_LONG)); }, Math.max(0, deadline - Date.now()));
  });
  const run = work(() => late);
  run.catch(() => {}); // nobody awaits it once the deadline has passed
  try { return await Promise.race([run, timeout]); } finally { clearTimeout(timer); }
}

/**
 * Runs one mock draft end to end. Never throws: a failure is reported through the failed callback, like the Action.
 * Its Claude calls (the design agent, and the approximate mock-up drawn from code) run on the app's company key, like
 * the rest of its Claude work (withAppClaude): the demo and, during the beta, a company without a key use PMA's.
 */
export async function runMockDraft(p: DraftPayloadT, d: MockRunnerDeps = {}): Promise<void> {
  const projectId = d.app?.projectId;
  return projectId ? withAppClaude(projectId, () => runOnKey(p, d)) : runOnKey(p, d);
}

async function runOnKey(p: DraftPayloadT, d: MockRunnerDeps): Promise<void> {
  const appUrl = env.appUrl();
  const post = d.post ?? postCallback;
  try {
    await new Promise((r) => setTimeout(r, d.delayMs ?? MOCK_DELAY_MS));
    const frames = p.target_frames.slice(0, MAX_FRAMES);
    const screens = await (d.loadScreens ?? loadScreens)(p.draft_id, frames);
    const byId = new Map(screens.map((s) => [s.frame_id, s]));
    const drawable = frames.slice(0, AGENT_FRAMES).map((f) => byId.get(f)).filter((s): s is Screen & { source: string } => !!s && !!tryParseFrame(s.source));

    const before: Shot[] = [], after: Shot[] = [];
    const put = async (slot: number, png: Buffer) => {
      const target = p.upload_slots[slot];
      if (!target) throw new Error("no upload slot");
      const res = await fetch(target.url, { method: "PUT", headers: { "content-type": "image/png" }, body: new Uint8Array(png) });
      if (!res.ok) throw new Error(`upload ${res.status}`);
      return target.path;
    };
    const shooter = async () => d.shoot ?? (await import("@/lib/marver/shot")).renderFrameShot; // lazy: keeps next/og out of other routes

    // No screen to edit, and a customer app's repository to draw from: an approximate mock-up from the code. Its 2 to 4
    // Claude calls run inside the draft route's 300 s after(), so it stops itself at MOCKUP_BUDGET_MS and fails cleanly.
    const app = d.app;
    if (!drawable.length && app?.code) {
      const code = app.code;
      const deadline = Date.now() + MOCKUP_BUDGET_MS;
      await withDeadline(async (expired) => {
        const { today, todayFrame, end } = await drawFromCode(p, { ...app, code }, d, deadline);
        if (expired()) return;
        const shoot = await shooter();
        before.push({ frame_id: today.frame_id, path: await put(0, await shoot(todayFrame, { size: code.size })) });
        after.push({ frame_id: today.frame_id, path: await put(1, await shoot(end.frame, { marks: true, size: code.size })) });
        if (expired()) return;
        await post(p.callback_url, buildMockCallback(p, { before, after }, appUrl, [], { approximate: true, changed: end.changed, source: end.source }));
      }, deadline);
      return;
    }

    // The design agent edits the one Marver frame that best shows the finished change.
    let end: DraftedFrame | null = null;
    if (drawable.length) {
      const designer = d.designer ?? ((b: Brief, f: SourceFrame[]) => {
        if (!app) throw new Error("the app's profile wasn't passed to the mock runner");
        return draftEndResult(callStructured, b, f, { profile: app.profile, size: PHONE_FRAME });
      });
      try { end = await designer(briefOf(p), drawable.map((s) => ({ frame_id: s.frame_id, title: s.title, source: s.source }))); }
      catch (e) { console.error("[mock-runner] the design agent didn't finish; drawing the schematic instead", p.draft_id, e); }
    }

    let files: DraftedFile[] = [];
    if (end) {
      const shoot = await shooter();
      const current = tryParseFrame(byId.get(end.frame_id)?.source)!;
      before.push({ frame_id: end.frame_id, path: await put(0, await shoot(current, {})) });
      after.push({ frame_id: end.frame_id, path: await put(1, await shoot(end.frame, { marks: true })) });
      files = [{ frame_id: end.frame_id, path: `design/scenes/${end.frame_id}.tsx`, source: end.source, changed: end.changed }];
      const proposal = proposalOf(p.solution);
      await writeCanvasBoard({
        shortId: p.issue_short_id.toLowerCase(), title: `PMA: ${proposal.title}`, description: end.changed,
        rows: [[{ frame_id: end.frame_id }, { frame_id: end.frame_id, source: end.source }]],
      }).catch((e) => console.error("[mock-runner] couldn't write to the local Marver canvas", e));
    } else {
      // No frame source, or the agent failed: the schematic frames, as before.
      const proposal = proposalOf(p.solution);
      const { renderFramePng } = await import("@/lib/slack/mockupImage");
      let slot = 0;
      for (const f of frames) {
        const s = byId.get(f);
        const base = { title: s?.title || f, description: s?.description || "", source: "Mock runner" };
        for (const [side, list, heading] of [["before", before, "Current"], ["after", after, "Proposed"]] as const) {
          if (!p.upload_slots[slot]) break;
          const png = await renderFramePng(demoFrameModel({ ...base, side, proposal: side === "after" ? proposal : undefined }), heading);
          list.push({ frame_id: f, path: await put(slot++, png) });
        }
      }
    }
    await post(p.callback_url, buildMockCallback(p, { before, after }, appUrl, files));
  } catch (e) {
    // Still on the app's key here, so a credit or key problem names whose key it was (also for an injected model).
    const message = friendlyLlmError(ownKeyWording(e)).slice(0, 200);
    console.error("[mock-runner] failed", p.draft_id, e);
    try {
      await post(p.callback_url, { draft_id: p.draft_id, token: p.callback_token, status: "failed", log_url: `${mockPrUrl(appUrl, p.draft_id)}?failed=${encodeURIComponent(message)}`, error: message });
    } catch {
      await (d.markFailed ?? markFailed)(p.draft_id, message).catch((err) => console.error("[mock-runner] couldn't mark the draft failed", p.draft_id, err));
    }
  }
}
