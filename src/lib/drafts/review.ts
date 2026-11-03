// Pure rules for the review step: what Approve and merge does with the latest draft, and the Request changes note.

export type ReviewDraft = { id: string; status: string; demo: boolean; pr_number: number | null; pr_state: string | null; backend?: string | null } | null;
export type ApprovePlan =
  | { kind: "github"; prNumber: number }
  | { kind: "demo" }
  /** Made by the mock runner: its pull request is a page in this app, so approving ships without GitHub. */
  | { kind: "mock" }
  | { kind: "error"; reason: "no_draft" | "not_ready" | "already_merged" | "closed" | "no_pr" };

export function approvePlan(d: ReviewDraft): ApprovePlan {
  if (!d) return { kind: "error", reason: "no_draft" };
  if (d.status !== "ready") return { kind: "error", reason: "not_ready" };
  if (d.pr_state === "merged") return { kind: "error", reason: "already_merged" };
  if (d.pr_state === "closed") return { kind: "error", reason: "closed" };
  if (d.demo) return { kind: "demo" };
  if (d.backend === "mock") return { kind: "mock" };
  if (!d.pr_number) return { kind: "error", reason: "no_pr" };
  return { kind: "github", prNumber: d.pr_number };
}

export const APPROVE_ERROR: Record<Extract<ApprovePlan, { kind: "error" }>["reason"], string> = {
  no_draft: "There's no draft to approve yet",
  not_ready: "The draft isn't ready for review yet",
  already_merged: "This draft is already merged",
  closed: "This draft's PR was closed. Implement the proposal again",
  no_pr: "This draft has no pull request to merge",
};

/** The solution text the drafting agent receives; a reviewer note rides along on Request changes. */
export function solutionText(title: string, summary: string, note?: string): string {
  return note ? `${title}: ${summary}\n\nReviewer note: ${note}` : `${title}: ${summary}`;
}

export const NOTE_MAX = 1000;
export function parseNote(body: unknown): { note: string } | { error: string } {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>).note : undefined;
  const note = typeof raw === "string" ? raw.trim() : "";
  if (!note) return { error: "Add a note describing the change" };
  if (note.length > NOTE_MAX) return { error: `Keep the note under ${NOTE_MAX} characters` };
  return { note };
}
