import type { Lane, Thresholds, Weights } from "@/lib/types";
import type { ScoreInputs } from "@/lib/scoring";
import type { ScreenCandidate } from "./mapScreens";
import type { IssueCandidate } from "./cluster";
import type { AppProduct } from "@/lib/product/profile";

export interface SourceRow {
  id: string; project_id: string; raw_text: string; author: string | null; channel: string | null; route: string | null; occurred_at: string;
  kind: string; file_path: string | null; metadata: Record<string, unknown> | null;
}
export interface ProjectContext {
  jobs: { id: string; code: string; title: string }[]; routeMap: Record<string, string>; weights: Weights; thresholds: Thresholds; fewShots: string;
  /** What the app is and who its feedback can come from (productOf the project row), so every prompt speaks of this app. */
  product: AppProduct;
}
export interface NewUnit {
  quote: string; span_start: number | null; span_end: number | null; speakers: string[]; corroborators: string[]; reported_count: number;
  type: string; filtered_reason: string | null; sentiment: number | null; emotion: string | null; audience: string | null;
  severity_signals: Record<string, boolean>; job_code: string | null; embedding: number[] | null;
  /** When the feedback happened: its source's occurred_at, not when it was filed. */
  occurred_at: string;
}
export interface IssueForScoring {
  id: string; title: string; problem_statement: string; type: "bug" | "new_feature" | "add_on" | "streamline"; lane: Lane | null;
  /** The previous score and what produced it, to log what changed. */
  importance: number | null; breakdown: { inputs?: ScoreInputs; severity?: number; reach?: number; clarity?: number; scope?: string } | null;
  units: { quote: string; speakers: string[]; corroborators: string[]; reported_count: number; sentiment: number | null; emotion: string | null; severity_signals: Record<string, boolean> | null; occurred_at: string }[];
  screens: { frame_id: string; confidence: number }[];
}
export interface PipelineRepo {
  getSource(id: string): Promise<SourceRow>;
  /** Stores a recording's transcript as the source text, so a retry skips transcription. */
  saveTranscript(id: string, text: string, metadata: Record<string, unknown>): Promise<void>;
  /** Atomically moves a queued/failed (or stale-processing) source to processing. False means another run owns it. */
  claimSource(id: string): Promise<boolean>;
  setSourceStatus(id: string, status: "done" | "failed", error?: string): Promise<void>;
  /** Deletes the source's existing units (retry cleanup); returns the distinct issue ids they were attached to. */
  resetSourceUnits(sourceId: string): Promise<string[]>;
  /** Deletes the issue when it has no units left; returns whether it was deleted. */
  deleteIssueIfEmpty(issueId: string): Promise<boolean>;
  getProjectContext(projectId: string): Promise<ProjectContext>;
  getScreenByFrame(projectId: string, frameId: string): Promise<ScreenCandidate | null>;
  insertUnits(sourceId: string, projectId: string, units: NewUnit[]): Promise<{ id: string }[]>;
  matchScreens(projectId: string, embedding: number[], k: number): Promise<ScreenCandidate[]>;
  matchIssues(projectId: string, embedding: number[], k: number, minSim: number): Promise<IssueCandidate[]>;
  /** Without embeddings: every screen of the project (up to `limit`), for the LLM to choose from. */
  listScreens(projectId: string, limit: number): Promise<ScreenCandidate[]>;
  /** Without embeddings: the most recently updated issues that aren't dismissed (up to `limit`). */
  listOpenIssues(projectId: string, limit: number): Promise<IssueCandidate[]>;
  /** `last_reported_at`: when its first piece happened. */
  createIssue(projectId: string, d: { title: string; problem_statement: string; type: string; job_code: string | null; embedding: number[] | null; last_reported_at: string }): Promise<string>;
  /** Files the piece under the issue and moves the issue's last_reported_at up to when the piece happened, never back. */
  attachUnit(unitId: string, issueId: string, screens: { screen_id: string; confidence: number; evidence: string }[]): Promise<void>;
  /** Records screen links for a unit that is not attached to an issue (praise). */
  mapUnitScreens(unitId: string, screens: { screen_id: string; confidence: number; evidence: string }[]): Promise<void>;
  getIssueForScoring(issueId: string): Promise<IssueForScoring>;
  saveScores(issueId: string, s: { importance: number; ease: number; lane: Lane; breakdown: unknown; people_count: number }): Promise<void>;
  logActivity(issueId: string, kind: string, payload: Record<string, unknown>): Promise<void>;
}
