// Finding the Slack workspace for an app, or the company for a workspace.
//
// A company installs PMA's Slack app with "Add to Slack" (OAuth v2): slack_installations holds one active row per
// workspace (team_id) and per company, and the bot token sits in Vault behind the company's slack connection. Events
// and clicks carry team_id and are routed by it. The deployment's original workspace, reached with SLACK_BOT_TOKEN,
// stays as a legacy route for demo apps (kind 'demo') whose company has not installed through OAuth yet, and only for
// events whose team_id is that token's own team.
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";
import { readSecret } from "@/lib/connections/store";
import { slackCall } from "./api";
import { withSlack, type SlackClient, type SlackTeamInfo } from "./context";

export type Installation = {
  id: string; org_id: string; connection_id: string; team_id: string; team_name: string | null; team_url: string | null;
  enterprise_id: string | null; bot_user_id: string | null; status: string;
};
const INSTALL_COLS = "id, org_id, connection_id, team_id, team_name, team_url, enterprise_id, bot_user_id, status";

const TTL_MS = 60_000;
const byOrg = new Map<string, { at: number; client: SlackClient }>();

/** Forget cached workspaces after an install, uninstall or disconnect. */
export function forgetSlackClients(): void {
  byOrg.clear();
  legacyTeam = null;
}

async function clientFor(inst: Installation, db: SupabaseClient): Promise<SlackClient | null> {
  const token = await readSecret(inst.connection_id, db);
  if (!token) return null;
  const team: SlackTeamInfo | null = inst.team_url && inst.bot_user_id ? { url: inst.team_url, team: inst.team_name ?? "", user_id: inst.bot_user_id, team_id: inst.team_id } : null;
  return { token, teamKey: inst.team_id, teamId: inst.team_id, team, orgId: inst.org_id, installationId: inst.id, connectionId: inst.connection_id, legacy: false };
}

/** The deployment's own workspace (SLACK_BOT_TOKEN), or null when it isn't configured. */
export function legacySlack(): SlackClient | null {
  const token = process.env.SLACK_BOT_TOKEN;
  return token ? { token, teamKey: "", teamId: null, team: null, orgId: null, installationId: null, connectionId: null, legacy: true } : null;
}

let legacyTeam: Promise<string | null> | null = null;
/** The env token's own team id (auth.test), cached; null when it can't be read. */
function legacyTeamId(token: string): Promise<string | null> {
  legacyTeam ??= slackCall<{ team_id?: string }>(token, "auth.test").then((r) => r.team_id ?? null, () => { legacyTeam = null; return null; });
  return legacyTeam;
}

export async function activeInstallation(where: { orgId?: string; teamId?: string }, db: SupabaseClient = serviceDb()): Promise<Installation | null> {
  let q = db.from("slack_installations").select(INSTALL_COLS).eq("status", "active");
  if (where.orgId) q = q.eq("org_id", where.orgId);
  if (where.teamId) q = q.eq("team_id", where.teamId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`slack installation lookup failed: ${error.message}`);
  return (data as Installation | null) ?? null;
}

/**
 * The workspace an app's Slack work goes to: its company's installation, else (demo apps only) the deployment's own
 * workspace, else null. A found workspace is cached per company for a minute; "none" is never cached, because pages
 * and API routes keep separate copies of this module and an install in one must show in the other at once.
 */
export async function slackForProject(projectId: string, db: SupabaseClient = serviceDb()): Promise<SlackClient | null> {
  const { data: p, error } = await db.from("projects").select("org_id, kind").eq("id", projectId).maybeSingle();
  if (error || !p) return null;
  const hit = byOrg.get(p.org_id);
  let client: SlackClient | null = hit && Date.now() - hit.at < TTL_MS ? hit.client : null;
  if (!client) {
    const inst = await activeInstallation({ orgId: p.org_id }, db);
    client = inst ? await clientFor(inst, db) : null;
    if (client) byOrg.set(p.org_id, { at: Date.now(), client });
    else byOrg.delete(p.org_id);
  }
  if (client) return client;
  return p.kind === "demo" ? legacySlack() : null;
}

/** The workspace an event or click came from: its installation, else the legacy workspace when the team matches. */
export async function slackForTeam(teamId: string | null, db: SupabaseClient = serviceDb()): Promise<SlackClient | null> {
  if (!teamId) return null;
  const inst = await activeInstallation({ teamId }, db);
  if (inst) return clientFor(inst, db);
  const legacy = legacySlack();
  if (legacy && (await legacyTeamId(legacy.token)) === teamId) return { ...legacy, teamId };
  return null;
}

/** The apps a workspace serves: every app of the installing company, or the demo apps still on the legacy workspace. */
export async function appsForSlack(c: SlackClient, db: SupabaseClient = serviceDb()): Promise<string[]> {
  if (c.orgId) {
    const { data } = await db.from("projects").select("id").eq("org_id", c.orgId);
    return (data ?? []).map((r) => r.id as string);
  }
  const { data: demos } = await db.from("projects").select("id, org_id").eq("kind", "demo");
  const { data: installed } = await db.from("slack_installations").select("org_id").eq("status", "active");
  const taken = new Set((installed ?? []).map((r) => r.org_id as string));
  return (demos ?? []).filter((d) => !taken.has(d.org_id as string)).map((d) => d.id as string);
}

/** Runs `fn` in the app's workspace, or returns null when the app has no Slack. Never throws for a missing workspace. */
export async function inSlackFor<T>(projectId: string, fn: (c: SlackClient) => Promise<T>): Promise<T | null> {
  const c = await slackForProject(projectId).catch((e: Error) => { console.error("[slack] workspace lookup failed", e.message); return null; });
  return c ? withSlack(c, () => fn(c)) : null;
}

/** Whether this app has Slack connected and its channels set up. */
export async function slackConnected(projectId: string, db: SupabaseClient = serviceDb()): Promise<boolean> {
  const c = await slackForProject(projectId, db).catch(() => null);
  if (!c) return false;
  const { data } = await db.from("slack_channels").select("role").eq("project_id", projectId).eq("role", "inbox").maybeSingle();
  return !!data;
}
