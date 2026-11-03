export type FeedbackType = "bug" | "new_feature" | "add_on" | "streamline" | "praise" | "question" | "irrelevant";
export const ISSUE_TYPES = ["bug", "new_feature", "add_on", "streamline"] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];
export type Lane = "quick_win" | "explore" | "watch" | "backlog";
export type IssueStatus = "new" | "drafting" | "draft_ready" | "in_review" | "ready_to_build" | "shipped" | "dismissed";
export type Scope = "copy" | "single_screen" | "multi_screen" | "new_flow" | "new_flow_backend";

export interface Weights {
  importance: { severity: number; reach: number; frequency: number; intensity: number; recency: number };
  ease: { scope: number; clarity: number; mapping: number };
}
export interface Thresholds { importanceHigh: number; easeHigh: number; watchMin: number; watchRecentReports: number }

export const DEFAULT_WEIGHTS: Weights = {
  importance: { severity: 0.35, reach: 0.25, frequency: 0.2, intensity: 0.1, recency: 0.1 },
  ease: { scope: 0.4, clarity: 0.3, mapping: 0.3 },
};
export const DEFAULT_THRESHOLDS: Thresholds = { importanceHigh: 60, easeHigh: 70, watchMin: 35, watchRecentReports: 2 };

export const SCOPE_VALUE: Record<Scope, number> = {
  copy: 0.1, single_screen: 0.3, multi_screen: 0.6, new_flow: 0.8, new_flow_backend: 1.0,
};
