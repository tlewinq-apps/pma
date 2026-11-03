// When PMA alerts people about an issue. Pure: the rules, the dedupe keys, and which alerts a new score triggers.
import { priorityChangeSince, type PriorityChange, type SignalCounts } from "@/lib/scoring";
import type { IssueType } from "@/lib/types";

export type AlertRules = {
  /** PMA user ids who get a Slack DM for every alert, besides the issue's owner. */
  recipients: string[];
  blockingBug: boolean;
  jump: { enabled: boolean; points: number };
  digest: { enabled: boolean };
};
export const DEFAULT_ALERT_RULES: AlertRules = { recipients: [], blockingBug: true, jump: { enabled: true, points: 15 }, digest: { enabled: true } };

export type AlertRule = "blocking_bug" | "jump";
export type Alert = { rule: AlertRule; key: string; detail: Record<string, unknown> };

const DAY_MS = 86_400_000;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** projects.alert_rules, tolerant of missing or malformed fields. */
export function parseAlertRules(json: unknown): AlertRules {
  const j = obj(json);
  const jump = obj(j.jump);
  const points = typeof jump.points === "number" && Number.isFinite(jump.points) ? Math.min(100, Math.max(1, Math.round(jump.points))) : DEFAULT_ALERT_RULES.jump.points;
  return {
    recipients: Array.isArray(j.recipients) ? j.recipients.filter((r): r is string => typeof r === "string") : [],
    blockingBug: bool(j.blockingBug, DEFAULT_ALERT_RULES.blockingBug),
    jump: { enabled: bool(jump.enabled, DEFAULT_ALERT_RULES.jump.enabled), points },
    digest: { enabled: bool(obj(j.digest).enabled, DEFAULT_ALERT_RULES.digest.enabled) },
  };
}

/** A bug someone says stops them finishing the task, or one rated as blocking, whatever its priority. */
export function isBlockingBug(type: IssueType, severity: number, signals: SignalCounts | null): boolean {
  return type === "bug" && (severity >= 5 || (signals?.blocks_task ?? 0) > 0);
}

/** alert_log dedupe keys: the unique row is what stops two concurrent rescores from sending twice. */
export const alertKey = {
  blocking: (issueId: string) => `blocking:${issueId}`,
  jump: (issueId: string, now: number) => `jump:${issueId}:${day(now)}`,
  digest: (now: number) => `digest:${day(now)}`,
  shipped: (issueId: string, sourceId: string) => `shipped:${issueId}:${sourceId}`,
};

/**
 * The alerts a fresh score triggers. `history` is the issue's priority_changed log, including this score.
 * A blocking bug alerts when it is new, or when it wasn't blocking at its last score (`wasBlocking` false); an issue
 * scored before signals were stored has an unknown past (null) and stays quiet rather than alerting on old news.
 */
export function alertsFor(e: {
  issueId: string; type: IssueType; severity: number; signals: SignalCounts | null; next: number; history: PriorityChange[]; now: number; rules: AlertRules;
  wasBlocking: boolean | null; isNew: boolean;
  /** When the last jump alert for this issue went out; one jump is reported once, whatever the date. */
  lastJumpAt?: number | null;
}): Alert[] {
  const out: Alert[] = [];
  if (e.rules.blockingBug && e.wasBlocking === false && isBlockingBug(e.type, e.severity, e.signals)) {
    out.push({ rule: "blocking_bug", key: alertKey.blocking(e.issueId), detail: { priority: e.next, new: e.isNew } });
  }
  if (e.rules.jump.enabled && !(e.lastJumpAt != null && e.now - e.lastJumpAt < DAY_MS)) {
    const change = priorityChangeSince(e.history, e.next, e.now, DAY_MS);
    if (change && change.to - change.from >= e.rules.jump.points) out.push({ rule: "jump", key: alertKey.jump(e.issueId, e.now), detail: change });
  }
  return out;
}
