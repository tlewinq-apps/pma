// The first step, pure core. Every issue gets one before anyone proposes anything (checks.ts names it per type: a bug
// runs diagnostics, a feature is scoped, an add-on finds where it fits, a streamline issue maps its steps), and
// proposals are then written from what it found. The column and these names say "diagnosis" because bugs came
// first. For the demo the run is simulated (no code is read or changed); everything around it is the real flow. A
// customer app's run reads its connected repository and cites the lines it rests on, or says it used the feedback only.
// The database side lives in run.ts.
import { ISSUE_TYPES } from "@/lib/types";

/** A line a finding rests on, in the app's repository. */
export type CodeRef = { path: string; line: number; note: string };
/** Where a customer app's finding came from: its repository at `ref` (read), or the feedback only (repo is the one
 *  connected, if any). The demo's simulated findings have none. */
export type FindingSource = { repo: string | null; ref: string | null; read: boolean };

/** What the run found: a one-sentence headline, then labelled facts (features, add-ons, streamline) or a bug's
 *  evidence and the logging it added. `cause` is the bug headline as older rows stored it. */
export type DiagnosisFinding = {
  headline: string; facts: { label: string; text: string }[]; evidence: string[]; logging_added: string[];
  where: string; confidence: "likely" | "confirmed"; cause?: string;
  code_refs?: CodeRef[]; source?: FindingSource;
};
export type Diagnosis = {
  status: "running" | "done" | "failed"; started_at: string; finished_at?: string | null; by?: string | null;
  steps: string[]; finding?: DiagnosisFinding | null; error?: string | null; simulated?: boolean;
};
/** needed: nobody has run it (or the last run failed or went stale); running; done. */
export type DiagnosisState = "needed" | "running" | "done";

/** How long the simulated run takes, so each step is visible as it ticks off. */
export const DIAGNOSIS_RUN_MS = 12_000;
/** A run that hasn't finished after this long died with its server; it can be run again. Reading a repository and
 *  writing the finding from it can take a few minutes. */
export const DIAGNOSIS_STALE_MS = 600_000;
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

const parseFacts = (v: unknown) => (Array.isArray(v) ? v : [])
  .filter((x): x is { label: string; text: string } => !!x && typeof x === "object" && typeof (x as { label?: unknown }).label === "string" && typeof (x as { text?: unknown }).text === "string")
  .map((x) => ({ label: x.label, text: x.text }));

const parseRefs = (v: unknown): CodeRef[] => (Array.isArray(v) ? v : [])
  .filter((x): x is CodeRef => !!x && typeof x === "object" && typeof x.path === "string" && x.path !== ""
    && Number.isInteger(x.line) && x.line > 0 && typeof x.note === "string")
  .map((x) => ({ path: x.path, line: x.line, note: x.note }));

/** A stored source, or undefined when malformed (a source that was read names its repository and ref). */
function parseSource(v: unknown): FindingSource | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const text = (x: unknown) => (x == null ? null : typeof x === "string" ? x : undefined);
  const repo = text(o.repo), ref = text(o.ref);
  if (typeof o.read !== "boolean" || repo === undefined || ref === undefined) return undefined;
  if (o.read && (!repo || !ref)) return undefined;
  return { repo, ref, read: o.read };
}

/** The `issues.diagnosis` column, checked; anything malformed reads as no diagnosis. */
export function parseDiagnosis(v: unknown): Diagnosis | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.status !== "running" && o.status !== "done" && o.status !== "failed") return null;
  if (typeof o.started_at !== "string") return null;
  const f = o.finding as Record<string, unknown> | null | undefined;
  const headline = f && typeof f === "object" ? (typeof f.headline === "string" ? f.headline : typeof f.cause === "string" ? f.cause : null) : null;
  const source = f && typeof f === "object" ? parseSource(f.source) : undefined;
  const finding: DiagnosisFinding | null = f && headline !== null
    ? {
        headline, facts: parseFacts(f.facts), evidence: strs(f.evidence), logging_added: strs(f.logging_added),
        where: typeof f.where === "string" ? f.where : "", confidence: f.confidence === "confirmed" ? "confirmed" : "likely",
        ...(typeof f.cause === "string" ? { cause: f.cause } : {}),
        ...(Array.isArray(f.code_refs) ? { code_refs: parseRefs(f.code_refs) } : {}),
        ...(source ? { source } : {}),
      }
    : null;
  return {
    status: o.status, started_at: o.started_at, finished_at: typeof o.finished_at === "string" ? o.finished_at : null,
    by: typeof o.by === "string" ? o.by : null, steps: strs(o.steps), finding, error: typeof o.error === "string" ? o.error : null,
    simulated: o.simulated !== false,
  };
}

const OWNER_NAME = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
/** A reference's line on GitHub, when the finding was read from an owner/name repository; null otherwise. */
export function codeRefUrl(source: FindingSource | null | undefined, ref: Pick<CodeRef, "path" | "line">): string | null {
  if (!source?.read || !source.repo || !source.ref || !OWNER_NAME.test(source.repo)) return null;
  if (source.repo.split("/").some((p) => p === "." || p === "..")) return null;
  const enc = (s: string) => s.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${source.repo}/blob/${enc(source.ref)}/${enc(ref.path)}#L${ref.line}`;
}

export const isStaleRun = (d: Pick<Diagnosis, "status" | "started_at">, now: number) =>
  d.status === "running" && now - Date.parse(d.started_at) > DIAGNOSIS_STALE_MS;

/** Where an issue is on its first step; null for anything that isn't an issue type. */
export function diagnosisState(type: string, d: Diagnosis | null | undefined, now: number = Date.now()): DiagnosisState | null {
  if (!(ISSUE_TYPES as readonly string[]).includes(type)) return null;
  if (d?.status === "done") return "done";
  if (d?.status === "running" && !isStaleRun(d, now)) return "running";
  return "needed";
}

/** True while proposals and mockups have to wait for the first step. */
export const awaitingDiagnosis = (type: string, d: Diagnosis | null | undefined, now?: number) => {
  const s = diagnosisState(type, d, now);
  return s === "needed" || s === "running";
};

/** The step the run is on at `now` (0-based); `count` once every step has had its time. */
export function stepAt(startedAt: string, now: number, count: number, runMs: number = DIAGNOSIS_RUN_MS): number {
  const t = Date.parse(startedAt);
  if (!Number.isFinite(t) || count <= 0) return 0;
  return Math.min(count, Math.max(0, Math.floor(((now - t) / runMs) * count)));
}

