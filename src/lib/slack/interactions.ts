// What a click, form submission or shortcut from Slack asks for. Pure; every id is validated (see ids.ts).
import { ACTION, LINK_PREFIX, SHORTCUT_SEND, VIEW, decodeMeta, unref, type Meta } from "./ids";

type Who = { user: string; responseUrl: string | null };
export type Interaction =
  | ({ kind: "open_write"; issueId: string; triggerId: string } & Who)
  | ({ kind: "open_edit"; issueId: string; solutionId: string; triggerId: string } & Who)
  | ({ kind: "open_changes"; issueId: string; draftId: string; triggerId: string } & Who)
  | ({ kind: "take" | "diagnose"; issueId: string } & Who)
  | ({ kind: "mock" | "retry"; issueId: string; solutionId: string } & Who)
  | ({ kind: "approve" | "flow"; issueId: string; draftId: string } & Who)
  | { kind: "submit_write" | "submit_edit" | "submit_changes"; meta: Meta; values: unknown; user: string }
  | ({ kind: "send"; channel: string; channelName: string | null; ts: string; text: string } & Who)
  | { kind: "ignore" };

const IGNORE = { kind: "ignore" } as const;
const s = (v: unknown) => (typeof v === "string" ? v : null);

export function parseInteraction(payload: unknown): Interaction {
  if (!payload || typeof payload !== "object") return IGNORE;
  const p = payload as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Slack payload, read defensively
  const user = s(p.user?.id);
  if (!user) return IGNORE;
  const responseUrl = s(p.response_url);

  if (p.type === "block_actions") {
    const a = p.actions?.[0];
    const id = s(a?.action_id), triggerId = s(p.trigger_id);
    if (!id || id.startsWith(LINK_PREFIX)) return IGNORE;
    const one = unref(a?.value, 1), two = unref(a?.value, 2);
    switch (id) {
      case ACTION.take: return one ? { kind: "take", issueId: one[0], user, responseUrl } : IGNORE;
      case ACTION.diagnose: return one ? { kind: "diagnose", issueId: one[0], user, responseUrl } : IGNORE;
      case ACTION.write: return one && triggerId ? { kind: "open_write", issueId: one[0], triggerId, user, responseUrl } : IGNORE;
      case ACTION.edit: return two && triggerId ? { kind: "open_edit", issueId: two[0], solutionId: two[1], triggerId, user, responseUrl } : IGNORE;
      case ACTION.changes: return two && triggerId ? { kind: "open_changes", issueId: two[0], draftId: two[1], triggerId, user, responseUrl } : IGNORE;
      case ACTION.mock: return two ? { kind: "mock", issueId: two[0], solutionId: two[1], user, responseUrl } : IGNORE;
      case ACTION.retry: return two ? { kind: "retry", issueId: two[0], solutionId: two[1], user, responseUrl } : IGNORE;
      case ACTION.approve: return two ? { kind: "approve", issueId: two[0], draftId: two[1], user, responseUrl } : IGNORE;
      case ACTION.flow: return two ? { kind: "flow", issueId: two[0], draftId: two[1], user, responseUrl } : IGNORE;
    }
    return IGNORE;
  }

  if (p.type === "view_submission") {
    const meta = decodeMeta(p.view?.private_metadata);
    const kind = ({ [VIEW.proposalWrite]: "submit_write", [VIEW.proposalEdit]: "submit_edit", [VIEW.changes]: "submit_changes" } as const)[s(p.view?.callback_id) ?? ""];
    if (!meta || !kind) return IGNORE;
    if (kind === "submit_edit" && !meta.solutionId) return IGNORE;
    if (kind === "submit_changes" && !meta.draftId) return IGNORE;
    return { kind, meta, values: p.view?.state?.values, user };
  }

  if (p.type === "message_action" && p.callback_id === SHORTCUT_SEND) {
    const channel = s(p.channel?.id), ts = s(p.message?.ts);
    if (!channel || !ts) return IGNORE;
    return { kind: "send", channel, channelName: s(p.channel?.name), ts, text: s(p.message?.text) ?? "", user, responseUrl };
  }
  return IGNORE;
}

/** The workspace a payload came from: team.id on clicks, forms and shortcuts (user.team_id as a fallback). */
export function teamOf(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { team?: { id?: unknown } | null; user?: { team_id?: unknown } | null };
  return s(p.team?.id) ?? s(p.user?.team_id);
}
