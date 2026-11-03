// Mock-ups for apps without a design canvas, pure core. A customer app whose proposal names no screens but whose
// repository is connected gets an approximate before/after drawn from its code: the mock runner re-reads the lines the
// first step named, the design agent draws today's screen from them, then the proposal over it (mockRunner.ts,
// marver/agent.ts frameFromCode). What it is drawn from, when it is refused and how the page labels it live here, so the
// dispatcher, the draft route and the issue page agree. No server imports: client components use it too.
import type { Diagnosis, DiagnosisFinding } from "@/lib/diagnosis/model";
import type { ProductProfile } from "@/lib/product/profile";
import type { LineSpan } from "@/lib/repo/context";
import { frameSizeFor, type FrameSize } from "@/lib/marver/frameSize";

export const APPROXIMATE_LABEL = "Approximate mock-up drawn from your code. It isn't a screenshot.";
export const CONNECT_REPO_TO_DRAW = "Connect your repository so PMA can draw this screen from your code.";
export const NEEDS_CODE_TO_DRAW = "PMA needs the first step to find the code before it can draw this screen.";
export const MOCKUP_TOO_LONG = "The mock-up took too long. Try again.";

/**
 * How long the mock runner gives one mock-up drawn from code: its 2 to 4 Claude calls run inside the draft route's 300 s
 * after(), so it stops itself first and fails the draft with MOCKUP_TOO_LONG rather than being killed mid-call.
 */
export const MOCKUP_BUDGET_MS = 240_000;
/** A frame the design agent got wrong is asked for again only with at least this long left (one more Opus call). */
export const REPAIR_MIN_MS = 60_000;
/** An approximate mock-up still drawing after this was killed with its function: it reads as failed, with Retry. */
export const MOCKUP_STALE_MS = 600_000;

/** What the mock runner needs to draw one: the repository, the lines to re-read, the screen, its size, and what to show. */
export type CodeMockup = { repo_full_name: string; watched_branch: string | null; org_id?: string | null; spans: LineSpan[]; screen: string; size: FrameSize; context: string };

type App = { kind: string | null | undefined; repo_full_name: string | null | undefined };

/** A customer app's proposal that names no screens, with a repository to draw from. The demo keeps its own path. */
export function drawsFromCode(app: App, targetFrames: readonly string[] | null | undefined): boolean {
  return app.kind !== "demo" && !!app.repo_full_name && !targetFrames?.length;
}

/** "Read src/a.tsx (lines 120–240)", as the first step's steps say it (diagnosis/checks.ts codeRunSteps). */
const READ_STEP = /^Read (.+) \(lines (\d+)[–-](\d+)\)$/;
/** "StudioScreen.web.tsx:330" in a sentence (the finding's evidence cites lines this way). */
const CITE = /((?:\.\/)?[\w@.\/-]*[\w@-]\.[A-Za-z]{1,6}):(\d+)/g;
const MAX_SPANS = 8;

/**
 * The lines to draw today's screen from: the finding's code_refs; without them, the files its steps say it read and the
 * path:line its evidence cites; otherwise none (and the mock-up is refused).
 */
export function mockupSpans(finding: DiagnosisFinding | null | undefined, steps: readonly string[]): LineSpan[] {
  const refs = finding?.code_refs ?? [];
  if (refs.length) return refs.slice(0, MAX_SPANS).map((r) => ({ path: r.path, from: r.line, to: r.line }));
  const out: LineSpan[] = [];
  for (const s of steps) {
    const m = READ_STEP.exec(s);
    if (m && Number(m[3]) >= Number(m[2])) out.push({ path: m[1], from: Number(m[2]), to: Number(m[3]) });
  }
  for (const e of [...(finding?.evidence ?? []), ...(finding?.facts ?? []).map((f) => f.text)]) {
    for (const m of e.matchAll(CITE)) out.push({ path: m[1], from: Number(m[2]), to: Number(m[2]) });
  }
  const seen = new Set<string>();
  const kept: LineSpan[] = [];
  for (const sp of out) {
    const key = `${sp.path}:${sp.from}:${sp.to}`;
    if (sp.from < 1 || seen.has(key)) continue;
    seen.add(key);
    kept.push(sp);
  }
  return kept.slice(0, MAX_SPANS);
}

/** Why a proposal can't be mocked up yet, in one sentence, or null when it can. Only for a customer app's proposal with no screens. */
export function mockupRefusal(app: App, targetFrames: readonly string[] | null | undefined, diagnosis: Diagnosis | null): string | null {
  if (app.kind === "demo" || targetFrames?.length) return null;
  if (!app.repo_full_name) return CONNECT_REPO_TO_DRAW;
  const finding = diagnosis?.status === "done" ? diagnosis.finding : null;
  return mockupSpans(finding, diagnosis?.steps ?? []).length ? null : NEEDS_CODE_TO_DRAW;
}

const oneLine = (s: string, max: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };

/**
 * The drawing job for one issue: which lines to re-read, the screen (where the finding says it happens), its size (the
 * app's platform, or where it was reported for an app that ships both) and what the drawing should show.
 */
export function codeMockupJob(i: {
  project: { repo_full_name: string; watched_branch: string | null; org_id?: string | null }; profile: ProductProfile;
  diagnosis: Diagnosis | null; channels: string[]; title: string;
}): CodeMockup {
  const finding = i.diagnosis?.status === "done" ? i.diagnosis.finding ?? null : null;
  const screen = oneLine(finding?.where || i.title, 160);
  const refs = finding?.code_refs ?? [];
  const context = [
    `Issue: ${oneLine(i.title, 200)}`,
    ...(finding ? [`What the first step found: ${oneLine(finding.headline, 400)}`] : []),
    ...(refs.length ? ["Lines that matter:", ...refs.slice(0, MAX_SPANS).map((r) => `- ${r.path}:${r.line} ${oneLine(r.note, 160)}`)] : []),
  ].join("\n");
  return {
    repo_full_name: i.project.repo_full_name, watched_branch: i.project.watched_branch, org_id: i.project.org_id ?? null,
    spans: mockupSpans(finding, i.diagnosis?.steps ?? []), screen,
    size: frameSizeFor(i.profile, [...i.channels, finding?.where ?? ""].filter(Boolean)), context,
  };
}

/** A mock-runner draft of a customer app: drawn by PMA, never a screenshot, and with no pull request behind it. */
export function isApproximate(draft: { backend: string | null } | null | undefined, project: { kind: string }): boolean {
  return !!draft && draft.backend === "mock" && project.kind !== "demo";
}

/**
 * An approximate mock-up still `dispatched` after MOCKUP_STALE_MS: its run stopped without a callback (the function was
 * killed, or the server restarted), so nothing will finish it. Unparseable timestamps are never stale.
 */
export function isStaleMockup(draft: { backend: string | null; status: string; created_at: string } | null | undefined, project: { kind: string }, now: number): boolean {
  if (!draft || !isApproximate(draft, project) || draft.status !== "dispatched") return false;
  const t = Date.parse(draft.created_at);
  return Number.isFinite(t) && now - t > MOCKUP_STALE_MS;
}

/** The reason the mock runner gave when it couldn't finish (it puts it on its run link as ?failed=), or null. */
export function mockupFailure(logUrl: string | null | undefined): string | null {
  if (!logUrl) return null;
  try { return new URL(logUrl).searchParams.get("failed") || null; } catch { return null; }
}

/** What the issue page tells nextStep about mock-ups drawn from code. */
export function codeMockupStep(d: { project: { kind: string; repo_full_name: string | null }; draft: { backend: string } | null }) {
  const customer = d.project.kind !== "demo";
  return { drawsFromCode: customer && !!d.project.repo_full_name, needsRepo: customer && !d.project.repo_full_name, approximate: isApproximate(d.draft, d.project) };
}
