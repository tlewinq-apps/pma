/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase nested selects are untyped */
// "Create full flow", database side, shared by the web and Slack. startFlowDraft claims the mock-up's draft for one
// flow run; runFlowDraft has the design agent plan the proposed flow from the Marver board the end-result screen sits
// on, draws its changed and new screens, renders current over proposed for Slack, and saves it on drafts.flow. Both
// use the service client: callers check the person may act on the issue first (RLS on the web, the workspace in Slack).
import { serviceDb } from "@/lib/db/server";
import { callStructured, type StructuredCaller } from "@/lib/llm/client";
import { withDraftClaude } from "@/lib/llm/scope";
import { draftFlowFrame, planFlow, type Brief, type DraftedFrame, type FlowStepPlan, type SourceFrame } from "@/lib/marver/agent";
import { pickFlow } from "@/lib/marver/boards";
import { tryParseFrame } from "@/lib/marver/frame";
import { flowState, flowSummary, parseDraftFlow, type DraftFlow, type FlowStep } from "@/lib/marver/flowModel";
import { screenSources, type ScreenSource } from "@/lib/marver/sources";
import { writeCanvasBoard } from "@/lib/marver/canvas";
import { friendlyLlmError } from "@/lib/llm/errors";
import { profileOfEmbedded } from "@/lib/product/profile";

export type StartFlowResult = { ok: true; already?: "drafting" | "ready"; draftId: string } | { ok: false; status: number; error: string };

const DRAFT_COLS = "id, issue_id, status, frames, flow, solution_id, created_at";

async function latestDraft(issueId: string) {
  const { data } = await serviceDb().from("drafts").select(DRAFT_COLS).eq("issue_id", issueId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data as any;
}

/** Claims the issue's latest mock-up for a flow run. A flow already drafting or drawn is reported, not started twice. */
export async function startFlowDraft(issueId: string, actor: { userId: string | null; name: string | null; via: "web" | "slack" }): Promise<StartFlowResult> {
  const db = serviceDb();
  const d = await latestDraft(issueId);
  if (!d || d.status !== "ready") return { ok: false, status: 409, error: "Mock it up first: the full flow is built from the reviewed screen." };
  // An approximate mock-up's frames entry holds only its line on what changed (no Marver frame to build a flow from).
  const end = (d.frames ?? []).find((f: { path?: string }) => !!f.path) as { frame_id: string } | undefined;
  if (!end) return { ok: false, status: 409, error: "This mock-up has no Marver frame to build a flow from. Re-draft it to get one." };
  const prev = parseDraftFlow(d.flow);
  const state = flowState(prev, Date.now());
  if (state === "drafting" || state === "ready") return { ok: true, already: state, draftId: d.id };

  const { data: issue } = await db.from("issues").select("project_id, issue_screens(position, screens(frame_id))").eq("id", issueId).maybeSingle();
  if (!issue) return { ok: false, status: 404, error: "not found" };
  const issueFrames = [...((issue as any).issue_screens ?? [])].sort((a: any, b: any) => a.position - b.position).map((s: any) => s.screens?.frame_id).filter(Boolean) as string[];
  const { data: flows } = await db.from("flows").select("board, title, frames, position").eq("project_id", (issue as any).project_id);
  const board = pickFlow((flows ?? []) as { board: string; title: string; frames: string[]; position: number }[], end.frame_id, issueFrames);
  // No Marver flow holds the screen: use the issue's own screens in order, ending on the reviewed one.
  const current = board ? board.frames : [...new Set([...issueFrames.filter((f) => f !== end.frame_id), end.frame_id])];
  const next: DraftFlow = { status: "drafting", board: board?.board ?? null, title: board?.title ?? "This issue's screens", started_at: new Date().toISOString(), by: actor.name, current, steps: [] };
  const claim = db.from("drafts").update({ flow: next }).eq("id", d.id);
  const { data: claimed, error } = await (prev ? claim.eq("flow->>started_at", prev.started_at) : claim.is("flow", null)).select("id");
  if (error) throw new Error(`flow: claim failed: ${error.message}`);
  if (!claimed?.length) return { ok: true, already: "drafting", draftId: d.id };
  await db.from("activity").insert({ issue_id: issueId, user_id: actor.userId, kind: "flow_requested", payload: { by: actor.name, flow: next.title, board: next.board, via: actor.via } });
  return { ok: true, draftId: d.id };
}

async function save(draftId: string, startedAt: string, flow: DraftFlow): Promise<boolean> {
  const { data } = await serviceDb().from("drafts").update({ flow }).eq("id", draftId).eq("flow->>started_at", startedAt).select("id");
  return !!data?.length;
}

export type FlowDeps = { llm?: StructuredCaller; render?: (title: string, steps: FlowStep[], frames: Map<string, string>) => Promise<string | null> };

/** Uploads current over proposed as one PNG and returns its public URL. Never throws: no image only means no Slack picture. */
async function renderAndUpload(issueId: string, draftId: string, title: string, steps: FlowStep[], current: Map<string, string>): Promise<string | null> {
  try {
    const { renderFlowShot } = await import("@/lib/marver/shot"); // lazy: keeps next/og out of other routes
    const png = await renderFlowShot(`${title}, full flow`, steps.map((s) => ({
      current: s.current ? tryParseFrame(current.get(s.current)) : null,
      proposed: tryParseFrame(s.source ?? (s.current ? current.get(s.current) : null)),
      change: s.change, title: s.title,
    })));
    const db = serviceDb();
    const path = `flows/${issueId}/${draftId}-${Date.now()}.png`;
    const { error } = await db.storage.from("shots").upload(path, png, { contentType: "image/png", upsert: true });
    if (error) throw new Error(error.message);
    return db.storage.from("shots").getPublicUrl(path).data.publicUrl;
  } catch (e) {
    console.error("[flow] couldn't render the flow image", e);
    return null;
  }
}

/** Plans and draws the proposed flow, then saves it. Never throws: a failure is saved on the flow and logged. */
export async function runFlowDraft(draftId: string, deps: FlowDeps = {}): Promise<void> {
  return withDraftClaude(draftId, () => runFlowDraftOnKey(draftId, deps));
}

async function runFlowDraftOnKey(draftId: string, deps: FlowDeps): Promise<void> {
  const db = serviceDb();
  const llm = deps.llm ?? callStructured;
  const { data: row } = await db.from("drafts")
    .select(`${DRAFT_COLS}, solutions(title, summary), issues(id, short_id, project_id, title, problem_statement, type, feedback_units(quote), projects(kind, product_profile, name))`)
    .eq("id", draftId).maybeSingle();
  const d = row as any;
  const flow = parseDraftFlow(d?.flow);
  if (!d || !flow || flow.status !== "drafting") return;
  const issue = d.issues;
  const fail = async (error: string) => {
    console.error("[flow] failed", draftId, error);
    await save(draftId, flow.started_at, { ...flow, status: "failed", error: error.slice(0, 300), finished_at: new Date().toISOString() });
    await db.from("activity").insert({ issue_id: issue.id, kind: "flow_failed", payload: { error: error.slice(0, 300) } });
  };
  try {
    const endFile = (d.frames ?? [])[0] as { frame_id: string; source: string; changed?: string };
    const endFrame = tryParseFrame(endFile?.source);
    if (!endFile || !endFrame) return await fail("The reviewed screen couldn't be read.");
    const end: DraftedFrame = { frame_id: endFile.frame_id, source: endFile.source, frame: endFrame, changed: endFile.changed ?? "" };
    const screens = await screenSources(db, issue.project_id, flow.current);
    const byId = new Map<string, ScreenSource>(screens.map((s) => [s.frame_id, s]));
    const sourceFrames: SourceFrame[] = flow.current.map((f) => ({ frame_id: f, title: byId.get(f)?.title ?? f, source: byId.get(f)?.source ?? "" })).filter((f) => f.source);
    if (!sourceFrames.some((f) => f.frame_id === end.frame_id)) return await fail("The reviewed screen isn't on this flow.");
    const brief: Brief = {
      title: issue.title, type: issue.type, problem: issue.problem_statement,
      proposal: { title: d.solutions?.title ?? issue.title, summary: d.solutions?.summary ?? "" },
      quotes: (issue.feedback_units ?? []).map((u: any) => u.quote).filter(Boolean),
    };

    const profile = profileOfEmbedded(issue.projects, "runFlowDraft");
    const plan = await planFlow(llm, brief, { title: flow.title, frames: sourceFrames }, end, profile);
    const titleOf = (s: FlowStepPlan) => s.title || byId.get(s.frame_id)?.title || s.frame_id;
    // Show the plan straight away; each screen lands as it is drawn.
    const steps: FlowStep[] = plan.map((s) => ({ current: s.current, frame_id: s.frame_id, change: s.change, title: titleOf(s), caption: s.caption, source: s.frame_id === end.frame_id ? end.source : null }));
    await save(draftId, flow.started_at, { ...flow, steps });

    const base = (s: FlowStepPlan): SourceFrame => s.current
      ? { frame_id: s.frame_id, title: byId.get(s.frame_id)?.title ?? s.frame_id, source: byId.get(s.frame_id)!.source! }
      : { frame_id: end.frame_id, title: "Reference", source: end.source };
    await Promise.all(plan.map(async (s, k) => {
      if (s.change === "same" || s.frame_id === end.frame_id) return;
      try {
        steps[k] = { ...steps[k], source: (await draftFlowFrame(llm, brief, s, base(s), end, profile)).source };
      } catch (e) {
        // A screen that can't be drawn stays as it is today (or, if new, is left out) rather than failing the flow.
        console.error("[flow] screen not drawn", s.frame_id, e);
        steps[k] = { ...steps[k], change: s.change === "new" ? "new" : "same", source: null, caption: s.change === "new" ? "" : steps[k].caption };
      }
    }));
    const final = steps.filter((s) => s.change !== "new" || s.source);

    const current = new Map(screens.filter((s) => s.source).map((s) => [s.frame_id, s.source!]));
    const image_url = await (deps.render ?? ((t, st, cur) => renderAndUpload(issue.id, draftId, t, st, cur)))(flow.title, final, current);
    const canvas_board = await writeCanvasBoard({
      shortId: String(issue.short_id).toLowerCase(), suffix: "flow", title: `PMA flow: ${brief.proposal.title}`, description: `${flow.title}, current on top, proposed below`,
      rows: [
        final.map((s) => (s.current ? { frame_id: s.current } : null)),
        final.map((s) => (s.source ? { frame_id: s.frame_id, source: s.source } : { frame_id: s.current ?? s.frame_id })),
      ],
    }).catch((e) => { console.error("[flow] couldn't write to the local Marver canvas", e); return null; });

    const done: DraftFlow = { ...flow, status: "ready", steps: final, image_url, canvas_board, finished_at: new Date().toISOString() };
    if (!(await save(draftId, flow.started_at, done))) return; // replaced by a newer run
    await db.from("activity").insert({ issue_id: issue.id, kind: "flow_ready", payload: { flow: flow.title, board: flow.board, summary: flowSummary(final), draft_id: draftId } });
  } catch (e) {
    console.error("[flow] run threw", draftId, e);
    await fail(friendlyLlmError(e));
  }
}
