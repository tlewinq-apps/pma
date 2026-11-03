// Which Slack workspace a call talks to. Every Slack entry point (an event, a click, a sync for an issue, the sweep,
// Settings) resolves a SlackClient first (src/lib/slack/tenant.ts) and runs its work inside withSlack(), so slackApi
// always carries that workspace's bot token and nothing reaches another company's Slack. Outside withSlack there is no
// token: slackApi refuses rather than guess.
import { AsyncLocalStorage } from "node:async_hooks";

export type SlackTeamInfo = { url: string; team: string; user_id: string; team_id?: string };

export type SlackClient = {
  token: string;
  /** The workspace key for per-workspace rows (slack_users): the team id, or "" for the deployment's own workspace. */
  teamKey: string;
  teamId: string | null;
  /** Workspace URL, name and the bot's user id, when known from the installation; null means ask auth.test. */
  team: SlackTeamInfo | null;
  /** The company that installed Slack. Null for the deployment's own workspace (the demo's SLACK_BOT_TOKEN). */
  orgId: string | null;
  installationId: string | null;
  connectionId: string | null;
  /** The deployment's original workspace, reached with the env bot token. */
  legacy: boolean;
};

const store = new AsyncLocalStorage<SlackClient>();

export const currentSlack = (): SlackClient | null => store.getStore() ?? null;

export function withSlack<T>(client: SlackClient, fn: () => Promise<T>): Promise<T> {
  return store.run(client, fn);
}

/** The workspace key for slack_users rows, or null outside a workspace. */
export const teamKey = (): string | null => currentSlack()?.teamKey ?? null;

export class NoSlackWorkspace extends Error {
  constructor() { super("No Slack workspace for this call"); }
}

/** The product name people see in Slack. */
export const brand = (): "PMA" => "PMA";
