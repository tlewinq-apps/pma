// Thin Slack Web API client (raw fetch, like the rest of the codebase). Bodies are form-encoded because several read
// methods (users.info, users.lookupByEmail, conversations.list) ignore JSON; nested values go as JSON strings.
// The bot token comes from the workspace the caller is working in (withSlack, src/lib/slack/context.ts).
import { currentSlack, NoSlackWorkspace, type SlackTeamInfo } from "./context";

export class SlackError extends Error {
  constructor(readonly method: string, readonly code: string) { super(`Slack ${method}: ${code}`); }
}

type Json = Record<string, unknown>;

export const slackApiUrl = () => process.env.SLACK_API_URL ?? "https://slack.com/api"; // override: local Slack mock

/** One Web API call with an explicit token (OAuth and auth.test before a workspace is set up). */
export async function slackCall<T extends Json = Json>(token: string | null, method: string, args: Json = {}, retried = false): Promise<T> {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(args)) if (v !== undefined && v !== null) form.set(k, typeof v === "string" ? v : JSON.stringify(v));
  const r = await fetch(`${slackApiUrl()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: form,
    signal: AbortSignal.timeout(10_000),
  });
  // chat.postMessage allows about one message per second per channel; a new card's catch-up can burst past that.
  const wait = Number(r.headers.get("retry-after"));
  if (r.status === 429 && !retried && wait <= 5) {
    await new Promise((res) => setTimeout(res, (wait || 1) * 1000));
    return slackCall<T>(token, method, args, true);
  }
  const j = (await r.json().catch(() => ({ ok: false, error: `http_${r.status}` }))) as Json;
  if (!j.ok) throw new SlackError(method, String(j.error ?? "unknown"));
  return j as T;
}

/** A Web API call in the current workspace (withSlack). Throws NoSlackWorkspace outside one. */
export async function slackApi<T extends Json = Json>(method: string, args: Json = {}): Promise<T> {
  const c = currentSlack();
  if (!c) throw new NoSlackWorkspace();
  return slackCall<T>(c.token, method, args);
}

/** Replies through an interaction's response_url (works in channels the bot is not in). Best-effort. */
export async function respond(responseUrl: string, body: Json): Promise<void> {
  try {
    await fetch(responseUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    console.error("[slack] response_url failed", e);
  }
}

export const ephemeral = (text: string) => ({ response_type: "ephemeral", replace_original: false, text });

const teams = new Map<string, Promise<SlackTeamInfo>>();
/**
 * The current workspace's URL, name and the bot's own user id: from the installation when it has them, else auth.test,
 * cached per token for the process (a failure is not cached).
 */
export function slackTeam(): Promise<SlackTeamInfo> {
  const c = currentSlack();
  if (!c) return Promise.reject(new NoSlackWorkspace());
  if (c.team) return Promise.resolve(c.team);
  let t = teams.get(c.token);
  if (!t) {
    t = slackCall<SlackTeamInfo>(c.token, "auth.test").catch((e) => { teams.delete(c.token); throw e; });
    teams.set(c.token, t);
  }
  return t;
}
