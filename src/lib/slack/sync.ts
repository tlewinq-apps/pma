/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase nested selects are untyped; rows are mapped by hand */
// Keeps Slack in step with PMA. One card per issue in its type's channel, edited in place; the card's thread
// replays the issue's activity after a per-thread cursor (activity.id), so actions taken in Slack, in the web
// workspace or by GitHub all show up the same way. Plus the pinned board in #pma-feedback and the App Home tab.
// Best-effort everywhere: nothing here throws into a caller, and the cron sweep picks up anything missed.
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";
import { env, slackEnabled } from "@/lib/env";
import { stageOf, type Stage } from "@/components/triage/views";
import { parseDiagnosis, type Diagnosis } from "@/lib/diagnosis/model";
import { resultLines } from "@/lib/diagnosis/checks";
import type { IssueType, Lane } from "@/lib/types";
import { advanceDemoDrafts } from "@/lib/drafts/demoRepo";
import { DEMO_DRAFT_MS } from "@/lib/drafts/demo";
import { SlackError, slackApi, slackTeam } from "./api";
import { permalink } from "./ids";
import { approximateMockup, boardMessage, homeGroups, homeView, issueCard, type BoardItem, type ChannelRole, type SlackWording } from "./cards";
import { currentSlack } from "./context";
import { inSlackFor, slackForProject } from "./tenant";
import { profileOf, type ProfileSource } from "@/lib/product/profile";
import { peopleTextFor } from "@/lib/proposals";
import { activitySteps, catchUpSteps, failedMessage, flowMessage, letterFor, mockupMessage, proposalGoneMessage, proposalsMessage, type Step } from "./messages";
import { flowSummary, parseDraftFlow } from "@/lib/marver/flowModel";
import { mockupImages, type DraftForImages } from "./mockupImage";
import { displayNames, notMemberText, resolveSlackUser } from "./users";

export type Connection = {
  projectId: string; channels: Partial<Record<ChannelRole, { id: string; boardTs: string | null }>>; roleOf: Map<string, ChannelRole>;
  /** A customer app's words for its feedback (from its product profile); null for the demo, which keeps its own copy. */
  customer: SlackWording | null;
};

/** An app's channels from Settings, or null before setup. Which workspace they live in comes from withSlack. */
export async function connectionFor(projectId: string, db: SupabaseClient = serviceDb()): Promise<Connection | null> {
  const [{ data, error }, { data: p }] = await Promise.all([
    db.from("slack_channels").select("role, channel_id, board_ts").eq("project_id", projectId),
    db.from("projects").select("kind, product_profile, name").eq("id", projectId).maybeSingle(),
  ]);
  if (error || !data?.length) return null;
  const conn: Connection = { projectId, channels: {}, roleOf: new Map(), customer: p && p.kind !== "demo" ? { audience: profileOf(p as ProfileSource).audience } : null };
  for (const r of data) {
    conn.channels[r.role as ChannelRole] = { id: r.channel_id, boardTs: r.board_ts };
    conn.roleOf.set(r.channel_id, r.role as ChannelRole);
  }
  return conn;
}

/** The app among `projectIds` that owns this channel, as a connection; null when none of them does. */
export async function connectionForChannel(channel: string, projectIds: string[], db: SupabaseClient = serviceDb()): Promise<Connection | null> {
  if (!projectIds.length) return null;
  const { data } = await db.from("slack_channels").select("project_id").eq("channel_id", channel).in("project_id", projectIds).maybeSingle();
  return data ? connectionFor(data.project_id as string, db) : null;
}

/** The first of these apps with channels set up (App Home and the shortcut outside an app's channels). */
export async function firstConnection(projectIds: string[], db: SupabaseClient = serviceDb()): Promise<Connection | null> {
  if (!projectIds.length) return null;
  const { data } = await db.from("slack_channels").select("project_id").in("project_id", projectIds).eq("role", "inbox").order("project_id").limit(1).maybeSingle();
  return data ? connectionFor(data.project_id as string, db) : null;
}

const issueUrl = (id: string) => `${env.appUrl()}/issues/${id}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Slack errors that mean the message we meant to edit is gone (deleted, archived channel, bot removed). */
const GONE = new Set(["message_not_found", "channel_not_found", "cant_update_message", "is_archived", "not_in_channel", "edit_window_closed"]);
const isGone = (e: unknown) => e instanceof SlackError && GONE.has(e.code);

export const post = (channel: string, threadTs: string | null, msg: Record<string, unknown>) =>
  slackApi<{ ts: string }>("chat.postMessage", { channel, ...(threadTs ? { thread_ts: threadTs } : {}), ...msg, unfurl_links: false, unfurl_media: false });
export const update = (channel: string, ts: string, msg: Record<string, unknown>) => slackApi("chat.update", { channel, ts, ...msg });

// Message refs belong to an app (slack_posts is keyed by project and ref). proposals:<issue> (the one proposals message), draft:<issue>:<draft> (closed:draft:… once its buttons
// are gone), source:<source>, guide:<role> (a channel's pinned guide). solution:<issue>:<solution> are the
// one-message-per-proposal posts from before the proposals message; they're marked replaced the first time it posts.
export async function getPost(db: SupabaseClient, projectId: string, ref: string) {
  return (await db.from("slack_posts").select("channel_id, ts").eq("project_id", projectId).eq("ref", ref).maybeSingle()).data as { channel_id: string; ts: string } | null;
}
export async function putPost(db: SupabaseClient, projectId: string, ref: string, channel: string, ts: string) {
  await db.from("slack_posts").upsert({ project_id: projectId, ref, channel_id: channel, ts }, { onConflict: "project_id,ref" });
}
async function postsWithPrefix(db: SupabaseClient, projectId: string, prefix: string) {
  return ((await db.from("slack_posts").select("ref, channel_id, ts").eq("project_id", projectId).like("ref", `${prefix}%`)).data ?? []) as { ref: string; channel_id: string; ts: string }[];
}

const SOL_COLS = "id, rank, title, summary, tradeoffs, effort, risk, recommended, origin, edited_by, edited_at, target_frames";
const DRAFT_COLS = "id, issue_id, status, demo, backend, pr_url, pr_state, solution_id, before_images, after_images, log_url, created_at, frames, flow";
type Solution = { id: string; rank: number; title: string; summary: string; tradeoffs: string | null; effort: string | null; risk: string | null; recommended: boolean; origin: string; edited_by: string | null; edited_at: string | null; target_frames: string[] | null };
type Draft = DraftForImages & {
  status: string; backend: string | null; pr_url: string | null; pr_state: string | null; log_url: string | null; created_at: string;
  frames: { frame_id: string; path: string; changed?: string }[] | null; flow: unknown;
};
type Snap = {
  id: string; project_id: string; title: string; type: IssueType; lane: Lane | null; status: string; people_count: number; importance: number | null;
  severity: number | null; owner_id: string | null; solutions: Solution[]; draft: Draft | null; quote: { text: string; author: string | null } | null;
  stage: Stage; diagnosis: Diagnosis | null;
  /** The app's kind: a customer app's mock-ups are approximate, approved to build rather than shipped. */
  kind: string | null;
  /** A customer app's count of people in its audience words ("1 shopper"); undefined for the demo, which keeps "1 person". */
  peopleText?: string;
};

async function latestDraft(db: SupabaseClient, issueId: string): Promise<Draft | null> {
  return (await db.from("drafts").select(DRAFT_COLS).eq("issue_id", issueId).order("created_at", { ascending: false }).limit(1).maybeSingle()).data as Draft | null;
}
async function solutionsOf(db: SupabaseClient, issueId: string): Promise<Solution[]> {
  return ((await db.from("solutions").select(SOL_COLS).eq("issue_id", issueId).order("rank")).data ?? []) as Solution[];
}

async function snapshot(db: SupabaseClient, issueId: string): Promise<Snap | null> {
  const [{ data: i }, solutions, draft, { data: unit }] = await Promise.all([
    db.from("issues").select("id, project_id, title, type, lane, status, people_count, importance, owner_id, diagnosis, score_breakdown, projects(kind, product_profile, name), feedback_units(audience)").eq("id", issueId).maybeSingle(),
    solutionsOf(db, issueId), latestDraft(db, issueId),
    db.from("feedback_units").select("quote, speakers, sources(author)").eq("issue_id", issueId).order("created_at").limit(1).maybeSingle(),
  ]);
  if (!i) return null;
  const diagnosis = parseDiagnosis(i.diagnosis);
  const stage = stageOf({ status: i.status, draft: draft ? { status: draft.status } : null, proposal: { count: solutions.length }, type: i.type, diagnosis });
  // Who said it, as in the activity log: the speaker in a call or thread, else whoever the source names.
  const quote = unit ? { text: (unit as any).quote as string, author: ((unit as any).speakers?.[0] ?? (unit as any).sources?.author ?? null) as string | null } : null;
  const b = (i as any).score_breakdown as { severity?: number; inputs?: { severity?: number } } | null;
  const severity = b?.inputs?.severity ?? b?.severity ?? null;
  const kind = ((i as any).projects?.kind as string | undefined) ?? null;
  const peopleText = peopleTextFor((i as any).projects, Number(i.people_count), (i as any).feedback_units);
  return { ...(i as any), people_count: Number(i.people_count), severity, solutions, draft, quote, stage, diagnosis, kind, peopleText };
}

function card(s: Snap, owner: string | null) {
  const d = s.draft;
  return issueCard({
    issueId: s.id, title: s.title, type: s.type, stage: s.stage, lane: s.lane, people: s.people_count, importance: s.importance,
    severity: s.severity, proposals: s.solutions.length, owner, quote: s.quote,
    url: issueUrl(s.id), prUrl: d?.pr_url ?? null, draftId: d?.status === "ready" ? d.id : null,
    failedSolutionId: s.stage === "failed" ? d?.solution_id ?? null : null, demo: !!d?.demo,
    approximate: approximateMockup(s.kind, d), peopleText: s.peopleText,
  });
}

type Ctx = { db: SupabaseClient; snap: Snap; channel: string; ts: string; proposalsDone?: boolean };

async function renderProposals(c: Ctx, sols: Solution[]) {
  const names = await displayNames(c.snap.project_id, sols.map((s) => s.origin === "pm" ? s.edited_by : null));
  const d = c.snap.draft;
  return proposalsMessage({
    issueId: c.snap.id, type: c.snap.type, stage: c.snap.stage,
    options: sols.map((s, k) => ({
      solutionId: s.id, letter: letterFor(k), title: s.title, summary: s.summary, recommended: s.recommended,
      by: s.origin === "pm" ? (s.edited_by ? names.get(s.edited_by) ?? "your team" : "your team") : null,
      status: d?.solution_id === s.id ? (d.status === "dispatched" ? "Drafting now" : d.status === "ready" ? "Mocked up" : null) : null,
    })),
  });
}

/**
 * The thread's one proposals message: posted the first time, edited in place after (names, edits, removals, and
 * which one is being mocked up). Older one-message-per-proposal posts are marked replaced the first time through.
 */
async function upsertProposals(c: Ctx) {
  const sols = await solutionsOf(c.db, c.snap.id);
  const ref = `proposals:${c.snap.id}`;
  const existing = await getPost(c.db, c.snap.project_id, ref);
  if (!existing && !sols.length) return;
  for (const old of await postsWithPrefix(c.db, c.snap.project_id, `solution:${c.snap.id}:`)) {
    try { await update(old.channel_id, old.ts, proposalGoneMessage()); } catch (e) { if (!isGone(e)) throw e; }
    await c.db.from("slack_posts").delete().eq("project_id", c.snap.project_id).eq("ref", old.ref);
  }
  const msg = await renderProposals(c, sols);
  if (existing) {
    try { await update(existing.channel_id, existing.ts, msg); c.proposalsDone = true; return; } catch (e) { if (!isGone(e)) throw e; }
  }
  const m = await post(c.channel, c.ts, msg);
  await putPost(c.db, c.snap.project_id, ref, c.channel, m.ts);
  c.proposalsDone = true;
}

async function mockupFor(c: Ctx, d: Draft, closed: string | null, reuseImages: boolean) {
  const { data: s } = d.solution_id ? await c.db.from("solutions").select("title").eq("id", d.solution_id).maybeSingle() : { data: null };
  const images = await mockupImages(c.db, c.snap.project_id, d, { reuse: reuseImages });
  const edited = d.frames?.[0] ?? null;
  return mockupMessage({
    issueId: c.snap.id, draftId: d.id, solutionTitle: (s?.title as string | undefined) ?? "the proposal", demo: d.demo,
    github: !d.demo && (d.backend ?? "github") === "github", images, prUrl: d.pr_url, url: issueUrl(c.snap.id), closed,
    changed: edited?.changed ?? null, path: edited?.path ?? null, flowable: !!edited, approximate: approximateMockup(c.snap.kind, d),
  });
}

/** Posts a drafted full flow into the thread, once per run. */
async function postFlow(c: Ctx, draftId: string) {
  const { data } = await c.db.from("drafts").select(`${DRAFT_COLS}, solutions(title)`).eq("id", draftId).eq("issue_id", c.snap.id).maybeSingle();
  const d = data as (Draft & { solutions?: { title?: string } | null }) | null;
  const flow = parseDraftFlow(d?.flow);
  if (!d || !flow || flow.status !== "ready") return;
  const ref = `flow:${c.snap.id}:${d.id}:${flow.started_at}`;
  if (await getPost(c.db, c.snap.project_id, ref)) return;
  const m = await post(c.channel, c.ts, flowMessage({
    title: flow.title, proposal: d.solutions?.title ?? "the proposal", board: flow.board, summary: flowSummary(flow.steps),
    imageUrl: flow.image_url ?? null, url: issueUrl(c.snap.id),
  }));
  await putPost(c.db, c.snap.project_id, ref, c.channel, m.ts);
}

async function postMockup(c: Ctx) {
  const d = await latestDraft(c.db, c.snap.id);
  if (!d || d.status !== "ready") return;
  const ref = `draft:${c.snap.id}:${d.id}`;
  if (await getPost(c.db, c.snap.project_id, ref)) return;
  const m = await post(c.channel, c.ts, await mockupFor(c, d, d.pr_state === "merged" ? "Approved and shipped." : null, false));
  await putPost(c.db, c.snap.project_id, ref, c.channel, m.ts);
}

/**
 * Swaps a posted mockup's buttons for a note: approved, changes requested, or replaced by a newer draft. Without an
 * id it closes every open one except the latest draft's. A closed mockup keeps its first note (a `closed:` marker).
 */
async function closeMockups(c: Ctx, draftId: string | null, note: string) {
  const posted = await postsWithPrefix(c.db, c.snap.project_id, `draft:${c.snap.id}:`);
  const closed = new Set((await postsWithPrefix(c.db, c.snap.project_id, `closed:draft:${c.snap.id}:`)).map((p) => p.ref.slice("closed:".length)));
  const latest = await latestDraft(c.db, c.snap.id);
  const targets = posted.filter((p) => !closed.has(p.ref) && (draftId ? p.ref.endsWith(`:${draftId}`) : !(latest && p.ref.endsWith(`:${latest.id}`))));
  for (const p of targets) {
    const { data: d } = await c.db.from("drafts").select(DRAFT_COLS).eq("id", p.ref.split(":")[2]).maybeSingle();
    if (!d) continue;
    try { await update(p.channel_id, p.ts, await mockupFor(c, d as Draft, note, true)); } catch (e) { if (!isGone(e)) throw e; }
    await putPost(c.db, c.snap.project_id, `closed:${p.ref}`, p.channel_id, p.ts);
  }
}

async function runStep(c: Ctx, step: Step) {
  switch (step.kind) {
    case "text": await post(c.channel, c.ts, { text: step.text, ...(step.broadcast ? { reply_broadcast: true } : {}) }); return;
    case "message": await post(c.channel, c.ts, step.msg); return;
    case "proposals": await upsertProposals(c); return;
    case "mockup": await postMockup(c); return;
    case "close_mockup": await closeMockups(c, step.draftId, step.note); return;
    case "flow": await postFlow(c, step.draftId); return;
    case "failed": {
      const d = await latestDraft(c.db, c.snap.id);
      await post(c.channel, c.ts, failedMessage({ issueId: c.snap.id, solutionId: d?.solution_id ?? null, logUrl: step.logUrl ?? d?.log_url ?? null, url: issueUrl(c.snap.id) }));
    }
  }
}

/** One pass. Returns true when another pass is due (more activity, or a demo draft just advanced). */
async function syncOnce(db: SupabaseClient, conn: Connection, issueId: string, catchUp: boolean): Promise<boolean> {
  const snap = await snapshot(db, issueId);
  if (!snap || snap.project_id !== conn.projectId) return false;
  // A customer app's cards go in its one cards channel; the demo's in the channel for the issue's type.
  const channel = conn.channels.cards?.id ?? conn.channels[snap.type]?.id;
  if (!channel) return false;

  let thread: { ts: string | null; channel_id: string | null; last_activity_id: number } | null = null;
  for (let attempt = 0; attempt < 4 && !thread; attempt++) {
    thread = ((await db.rpc("claim_slack_thread", { p_issue: issueId })).data as any[] | null)?.[0] ?? null;
    if (!thread) await sleep(1000); // another sync holds it; it re-checks for new activity before letting go
  }
  if (!thread) return false;

  let cursor = Number(thread.last_activity_id);
  let again = false;
  try {
    const names = await displayNames(snap.project_id, [snap.owner_id]);
    const msg = card(snap, snap.owner_id ? names.get(snap.owner_id) ?? "a teammate" : null);
    // A relabelled issue keeps its card where it is: the thread is its conversation.
    let ts = thread.ts, cardChannel = thread.channel_id ?? channel;
    if (ts) {
      try { await update(cardChannel, ts, msg); } catch (e) { if (isGone(e)) ts = null; else throw e; }
    }
    const fresh = !ts;
    if (!ts) {
      cardChannel = channel;
      ts = (await post(channel, null, msg)).ts;
      await db.from("slack_threads").update({ channel_id: channel, ts }).eq("issue_id", issueId);
    }
    const c: Ctx = { db, snap, channel: cardChannel, ts };
    const f = snap.diagnosis?.status === "done" ? snap.diagnosis.finding : null;
    const found = f ? { headline: f.headline, lines: resultLines(f) } : null;
    if (fresh && catchUp) for (const step of catchUpSteps(snap.stage, snap.solutions.length, snap.type, found)) await runStep(c, step);

    const { data: rows } = await db.from("activity").select("id, kind, payload, user_id").eq("issue_id", issueId).gt("id", cursor).order("id").limit(50);
    const actors = await displayNames(snap.project_id, (rows ?? []).map((r) => r.user_id));
    for (const r of rows ?? []) {
      const who = r.user_id ? actors.get(r.user_id) ?? "A teammate" : "PMA";
      for (const step of activitySteps(r, who, snap.type)) {
        // One refresh of the proposals message per pass is enough; it always renders the latest.
        if (step.kind === "proposals" && c.proposalsDone) continue;
        await runStep(c, step);
      }
      cursor = Number(r.id);
      await db.from("slack_threads").update({ last_activity_id: cursor }).eq("issue_id", issueId);
    }
    if ((rows ?? []).length === 50) again = true;
    // Keep the proposals message current even when no activity says so (a proposal renamed in the background).
    if (!c.proposalsDone && !fresh && (await getPost(db, snap.project_id, `proposals:${issueId}`))) await upsertProposals(c);

    // Demo drafts advance when something reads them; Slack is the reader here.
    const d = await latestDraft(db, issueId);
    if (d?.demo && d.status === "dispatched") {
      const due = Date.parse(d.created_at) + DEMO_DRAFT_MS + 300 - Date.now();
      if (due < 8_000) {
        await sleep(Math.max(0, due));
        await advanceDemoDrafts({ issueId });
        again = true;
      }
    }
  } finally {
    await db.from("slack_threads").update({ syncing_until: null }).eq("issue_id", issueId);
  }
  if (!again) {
    const { count } = await db.from("activity").select("id", { count: "exact", head: true }).eq("issue_id", issueId).gt("id", cursor);
    again = !!count;
  }
  return again;
}

/** Brings one issue's card and thread up to date. Never throws. */
export async function syncIssueToSlack(issueId: string, opts: { catchUp?: boolean; board?: boolean } = {}): Promise<void> {
  if (!slackEnabled()) return;
  try {
    const db = serviceDb();
    const { data: i } = await db.from("issues").select("project_id").eq("id", issueId).maybeSingle();
    if (!i) return;
    await inSlackFor(i.project_id as string, async () => {
      const conn = await connectionFor(i.project_id as string, db);
      if (!conn) return;
      for (let pass = 0; pass < 4; pass++) if (!(await syncOnce(db, conn, issueId, opts.catchUp ?? true))) break;
      if (opts.board !== false) await refreshBoard(conn);
    });
  } catch (e) {
    console.error("[slack] sync failed", issueId, e);
  }
}

/** Several cards, then the pinned board once (the daily re-score moves many issues at a time). Never throws. */
export async function syncIssuesToSlack(issueIds: string[]): Promise<void> {
  if (!slackEnabled() || !issueIds.length) return;
  for (const id of issueIds) await syncIssueToSlack(id, { board: false });
  try {
    const { data } = await serviceDb().from("issues").select("project_id").in("id", issueIds);
    for (const projectId of new Set((data ?? []).map((r) => r.project_id as string))) await refreshBoardFor(projectId);
  } catch (e) {
    console.error("[slack] board after sync failed", e);
  }
}

/** The app's pinned board, brought up to date in its own workspace. Never throws. */
export async function refreshBoardFor(projectId: string): Promise<void> {
  await inSlackFor(projectId, async () => {
    const conn = await connectionFor(projectId);
    if (conn) await refreshBoard(conn);
  });
}

async function boardItems(db: SupabaseClient, conn: Connection): Promise<BoardItem[]> {
  const { data: issues } = await db.from("issues").select("id, title, type, status, owner_id, updated_at, importance, diagnosis").eq("project_id", conn.projectId).neq("status", "dismissed").order("updated_at", { ascending: false }).limit(150);
  const list = issues ?? [];
  if (!list.length) return [];
  const ids = list.map((i) => i.id as string);
  const [{ data: drafts }, { data: sols }, { data: threads }, team] = await Promise.all([
    db.from("drafts").select("issue_id, status, created_at").in("issue_id", ids).order("created_at", { ascending: false }),
    db.from("solutions").select("issue_id").in("issue_id", ids),
    db.from("slack_threads").select("issue_id, channel_id, ts").in("issue_id", ids).not("ts", "is", null),
    slackTeam(),
  ]);
  const latest = new Map<string, string>();
  for (const d of drafts ?? []) if (!latest.has(d.issue_id)) latest.set(d.issue_id, d.status);
  const count = new Map<string, number>();
  for (const s of sols ?? []) count.set(s.issue_id, (count.get(s.issue_id) ?? 0) + 1);
  const link = new Map((threads ?? []).map((t) => [t.issue_id as string, permalink(team.url, t.channel_id, t.ts)]));
  const names = await displayNames(conn.projectId, list.map((i) => i.owner_id));
  return list.map((i) => ({
    title: i.title, type: i.type, ownerId: i.owner_id, owner: i.owner_id ? names.get(i.owner_id) ?? "a teammate" : null,
    stage: stageOf({ status: i.status, draft: latest.has(i.id) ? { status: latest.get(i.id)! } : null, proposal: { count: count.get(i.id) ?? 0 }, type: i.type, diagnosis: parseDiagnosis(i.diagnosis) }),
    link: link.get(i.id) ?? null, updatedAt: i.updated_at, importance: i.importance ?? null,
  }));
}

/**
 * Re-renders the pinned board, posting and pinning it if it's missing: in a customer app's cards channel, in the demo's
 * #pma-feedback. Runs in the app's workspace (withSlack). Never throws.
 */
export async function refreshBoard(conn: Connection): Promise<void> {
  const role: ChannelRole = conn.channels.cards ? "cards" : "inbox";
  const where = conn.channels[role];
  if (!where) return;
  try {
    const db = serviceDb();
    const msg = boardMessage(await boardItems(db, conn), Date.now(), env.appUrl(), conn.customer ?? undefined);
    if (where.boardTs) {
      try { await update(where.id, where.boardTs, msg); return; } catch (e) { if (!isGone(e)) throw e; }
    }
    const { ts } = await post(where.id, null, msg);
    await slackApi("pins.add", { channel: where.id, timestamp: ts }).catch((e) => console.warn("[slack] pin failed", e));
    await db.from("slack_channels").update({ board_ts: ts }).eq("project_id", conn.projectId).eq("role", role);
    where.boardTs = ts;
  } catch (e) {
    console.error("[slack] board failed", e);
  }
}

const channelIds = (conn: Connection) => Object.fromEntries(Object.entries(conn.channels).map(([role, c]) => [role, c!.id])) as Partial<Record<ChannelRole, string>>;

/** The App Home tab for one Slack user, for the workspace's app (`conn`, null before setup). Runs in that workspace. Never throws. */
export async function publishHome(slackUserId: string, conn: Connection | null): Promise<void> {
  try {
    const db = serviceDb();
    const now = Date.now();
    const customer = conn?.customer ?? (currentSlack()?.legacy ? undefined : { audience: "your users" });
    let view: object;
    if (!conn) view = homeView({ notMember: customer ? "PMA isn't set up in this workspace yet. In PMA, open Settings and set up the Slack channels." : "PMA isn't set up in this workspace yet. In PMA, open Settings and press Create channels.", groups: [], appUrl: env.appUrl(), now, customer });
    else {
      const person = await resolveSlackUser(slackUserId, conn.projectId);
      view = person.userId
        ? homeView({ notMember: null, groups: homeGroups(await boardItems(db, conn), person.userId), appUrl: env.appUrl(), now, channels: channelIds(conn), customer })
        : homeView({ notMember: notMemberText(person), groups: [], appUrl: env.appUrl(), now, customer });
    }
    await slackApi("views.publish", { user_id: slackUserId, view });
  } catch (e) {
    console.error("[slack] home failed", e);
  }
}

/**
 * Cron and setup: advance demo drafts, then sync issues whose card is missing or behind their activity, most
 * recently updated first. Never throws.
 */
export async function sweepSlack(limit = 20, onlyProjectId?: string): Promise<{ synced: number }> {
  if (!slackEnabled()) return { synced: 0 };
  let synced = 0;
  try {
    const db = serviceDb();
    // Every app with channels, each in its own workspace; an app whose company has no Slack (any more) is skipped.
    let q = db.from("slack_channels").select("project_id").eq("role", "inbox");
    if (onlyProjectId) q = q.eq("project_id", onlyProjectId);
    const { data: apps } = await q;
    for (const projectId of new Set((apps ?? []).map((r) => r.project_id as string))) {
      if (!(await slackForProject(projectId).catch(() => null))) continue;
      try {
        await advanceDemoDrafts({ projectId });
        const { data } = await db.rpc("slack_stale_issues", { p_project: projectId, p_limit: limit });
        const ids = ((data ?? []) as { issue_id: string }[]).map((r) => r.issue_id);
        for (const id of ids) await syncIssueToSlack(id, { board: false });
        await refreshBoardFor(projectId);
        synced += ids.length;
      } catch (e) {
        console.error("[slack] sweep failed for an app", projectId, e);
      }
    }
  } catch (e) {
    console.error("[slack] sweep failed", e);
  }
  return { synced };
}
