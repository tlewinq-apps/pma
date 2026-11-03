// What an incoming Slack event means for PMA. Pure: the events route looks up channels and the bot id first.

export type EventAction =
  | { kind: "ingest"; channel: string; ts: string; user: string; text: string }
  | { kind: "comment"; channel: string; threadTs: string; ts: string; user: string; text: string }
  /** A reply in a front-door thread: kept only when it answers follow-up questions PMA asked there. */
  | { kind: "reply"; channel: string; threadTs: string; ts: string; user: string; text: string }
  | { kind: "home"; user: string }
  | { kind: "ignore" };

export type EventContext = { inbox: string | null; categoryChannels: Set<string>; botUserId: string | null };

/** Message subtypes that are still a person writing something (edits, deletes and joins are not). */
const HUMAN_SUBTYPES = new Set([undefined, "file_share", "thread_broadcast"]);
const IGNORE = { kind: "ignore" } as const;

export function classifyEvent(event: unknown, ctx: EventContext): EventAction {
  if (!event || typeof event !== "object") return IGNORE;
  const e = event as Record<string, unknown>;
  const str = (k: string) => (typeof e[k] === "string" ? (e[k] as string) : undefined);
  if (e.type === "app_home_opened") return e.tab === "home" && str("user") ? { kind: "home", user: str("user")! } : IGNORE;
  if (e.type !== "message") return IGNORE;
  const channel = str("channel"), user = str("user"), ts = str("ts"), text = str("text")?.trim(), threadTs = str("thread_ts");
  if (e.bot_id || !HUMAN_SUBTYPES.has(str("subtype")) || !channel || !user || !ts || !text || user === ctx.botUserId) return IGNORE;
  const isReply = !!threadTs && threadTs !== ts;
  if (channel === ctx.inbox) return isReply ? { kind: "reply", channel, threadTs: threadTs!, ts, user, text } : { kind: "ingest", channel, ts, user, text };
  if (ctx.categoryChannels.has(channel) && isReply) return { kind: "comment", channel, threadTs: threadTs!, ts, user, text };
  return IGNORE;
}

/** Slack's message markup as plain feedback text: mentions, channel links, links and HTML entities. */
export function slackToPlain(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+(?:\|([^>]+))?>/g, (_, name) => `@${name ?? "someone"}`)
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, "#$1")
    .replace(/<!(here|channel|everyone)[^>]*>/g, "@$1")
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

export function tsToIso(ts: string): string | null {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(Math.round(n * 1000)).toISOString() : null;
}
