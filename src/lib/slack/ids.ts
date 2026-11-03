// Ids PMA puts into Slack (button values, modal metadata) and gets back on clicks. Pure; everything coming
// back from Slack is validated before it reaches a query.

export const ACTION = {
  take: "pma_take", write: "pma_write", mock: "pma_mock", edit: "pma_edit",
  approve: "pma_approve", changes: "pma_changes", retry: "pma_retry", diagnose: "pma_diagnose", flow: "pma_flow",
} as const;
/** URL buttons still post a block_actions payload; anything with this prefix is only acknowledged. */
export const LINK_PREFIX = "pma_link";
export const VIEW = { proposalWrite: "pma_proposal_write", proposalEdit: "pma_proposal_edit", changes: "pma_changes_note" } as const;
export const SHORTCUT_SEND = "pma_send";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** A button value: ids joined by ":" (issue, then the solution or draft the button acts on). */
export const ref = (...ids: string[]) => ids.join(":");

/** Exactly `n` UUIDs, or null. */
export function unref(v: unknown, n: number): string[] | null {
  if (typeof v !== "string") return null;
  const ids = v.split(":");
  return ids.length === n && ids.every(isUuid) ? ids : null;
}

export type Meta = { issueId: string; solutionId?: string; draftId?: string };

export const encodeMeta = (m: Meta) => JSON.stringify(m);

export function decodeMeta(v: unknown): Meta | null {
  if (typeof v !== "string") return null;
  let o: unknown;
  try { o = JSON.parse(v); } catch { return null; }
  if (!o || typeof o !== "object") return null;
  const { issueId, solutionId, draftId } = o as Record<string, unknown>;
  if (!isUuid(issueId)) return null;
  if (solutionId !== undefined && !isUuid(solutionId)) return null;
  if (draftId !== undefined && !isUuid(draftId)) return null;
  return { issueId, ...(solutionId ? { solutionId } : {}), ...(draftId ? { draftId } : {}) };
}

/** A message link. `teamUrl` is auth.test's `url` (https://acme.slack.com/). */
export const permalink = (teamUrl: string, channel: string, ts: string) => `${teamUrl.replace(/\/+$/, "")}/archives/${channel}/p${ts.replace(".", "")}`;
