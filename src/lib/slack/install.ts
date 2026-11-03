// Installing PMA's Slack app in a company's workspace (OAuth v2 "Add to Slack"), and losing it again.
//
// One workspace belongs to one company at a time and a company has one workspace: a second company that tries to add
// the same workspace is refused before anything is stored. The bot token goes to Vault behind the company's slack
// connection; slack_installations maps team_id to the company for routing. Uninstalling the app in Slack, or Slack
// revoking its token, marks the connection revoked and forgets the token. Every change is in the audit log.
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";
import { env } from "@/lib/env";
import { audit, disconnect, dropSecret, markConnection, putSecret, readSecret, saveConnection } from "@/lib/connections/store";
import { slackCall, SlackError } from "./api";
import { SLACK_SCOPES } from "./manifest";
import { activeInstallation, forgetSlackClients } from "./tenant";

export const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";

export const slackRedirectUri = () => `${env.appUrl().replace(/\/+$/, "")}/api/slack/oauth/callback`;

/** Where "Add to Slack" sends the person: Slack's consent screen for the bot scopes, coming back with `state`. */
export function slackAuthorizeUrl(state: string): string {
  const q = new URLSearchParams({ client_id: process.env.SLACK_CLIENT_ID ?? "", scope: SLACK_SCOPES.join(","), state, redirect_uri: slackRedirectUri() });
  return `${SLACK_AUTHORIZE_URL}?${q.toString()}`;
}

export type SlackAccess = {
  access_token: string; token_type?: string; scope?: string; bot_user_id?: string; app_id?: string;
  team?: { id: string; name?: string } | null; enterprise?: { id: string; name?: string } | null; is_enterprise_install?: boolean;
};

/** Swaps the code from the callback for the workspace's bot token (oauth.v2.access). */
export async function exchangeSlackCode(code: string): Promise<SlackAccess> {
  return slackCall<SlackAccess>(null, "oauth.v2.access", {
    client_id: process.env.SLACK_CLIENT_ID, client_secret: process.env.SLACK_CLIENT_SECRET, code, redirect_uri: slackRedirectUri(),
  });
}

export type InstallOutcome = { ok: true; team: string } | { ok: false; reason: "enterprise" | "taken" | "failed" };

/** Removes an app's channels and their cards, when the company moves to another workspace (the old ids mean nothing there). */
async function clearCompanySlack(db: SupabaseClient, orgId: string): Promise<void> {
  const { data: apps } = await db.from("projects").select("id").eq("org_id", orgId);
  for (const { id } of apps ?? []) {
    const { data: issues } = await db.from("issues").select("id").eq("project_id", id);
    const ids = (issues ?? []).map((i) => i.id as string);
    if (ids.length) await db.from("slack_threads").delete().in("issue_id", ids);
    await db.from("slack_posts").delete().eq("project_id", id);
    await db.from("slack_channels").delete().eq("project_id", id);
  }
}

/**
 * Stores a finished install for the company that started it. Refuses an Enterprise Grid org-wide install and a
 * workspace another company already has; a company adding a different workspace replaces its old one.
 */
export async function saveInstallation(access: SlackAccess, s: { orgId: string; projectId: string | null; userId: string }, db: SupabaseClient = serviceDb()): Promise<InstallOutcome> {
  if (access.is_enterprise_install || !access.team?.id) return { ok: false, reason: "enterprise" };
  const teamId = access.team.id;
  const token = access.access_token;
  const auth = await slackCall<{ url: string; team: string; user_id: string; team_id: string }>(token, "auth.test").catch(() => null);
  if (!auth || auth.team_id !== teamId) return { ok: false, reason: "failed" };

  const holder = await activeInstallation({ teamId }, db);
  if (holder && holder.org_id !== s.orgId) return { ok: false, reason: "taken" };
  const mine = await activeInstallation({ orgId: s.orgId }, db);
  if (mine && mine.team_id !== teamId) {
    await db.from("slack_installations").update({ status: "disconnected", updated_at: new Date().toISOString() }).eq("id", mine.id);
    await clearCompanySlack(db, s.orgId);
    await audit({ orgId: s.orgId, projectId: s.projectId, actorId: s.userId, action: "connection.replaced", target: "slack", detail: { team: mine.team_name, team_id: mine.team_id } }, db);
  }

  const display = { team: auth.team || access.team.name || null, team_url: auth.url, bot: auth.user_id };
  const conn = await saveConnection("slack", { orgId: s.orgId, projectId: null }, { status: "pending", display, externalId: teamId, userId: s.userId }, db);
  await putSecret(conn.id, token, db);
  const row = {
    org_id: s.orgId, connection_id: conn.id, team_id: teamId, team_name: display.team, team_url: auth.url, enterprise_id: access.enterprise?.id ?? null,
    app_id: access.app_id ?? null, bot_user_id: access.bot_user_id ?? auth.user_id, scopes: (access.scope ?? "").split(",").filter(Boolean),
    installed_by: s.userId, status: "active", updated_at: new Date().toISOString(), revoked_at: null,
  };
  if (holder) {
    const { error } = await db.from("slack_installations").update(row).eq("id", holder.id);
    if (error) return { ok: false, reason: "failed" };
  } else {
    const { error } = await db.from("slack_installations").insert(row);
    // Another company finished installing this workspace a moment ago: theirs stands, and this token is forgotten.
    if (error?.code === "23505") { await dropSecret(conn.id, db); await markConnection(conn.id, "disconnected", null, db); return { ok: false, reason: "taken" }; }
    if (error) return { ok: false, reason: "failed" };
  }
  await saveConnection("slack", { orgId: s.orgId, projectId: null }, { status: "ok", display, externalId: teamId, verified: true, userId: s.userId }, db);
  await audit({ orgId: s.orgId, projectId: s.projectId, actorId: s.userId, action: "connection.connected", target: "slack", detail: { team: display.team, team_id: teamId } }, db);
  forgetSlackClients();
  return { ok: true, team: display.team ?? teamId };
}

/**
 * The workspace removed PMA (app_uninstalled), or revoked its bot token (tokens_revoked, matched by bot user id).
 * The connection becomes revoked and the token is forgotten; the app's channels stay in case it's installed again.
 */
export async function revokeInstallation(teamId: string, reason: string, botUserIds?: string[], db: SupabaseClient = serviceDb()): Promise<void> {
  const inst = await activeInstallation({ teamId }, db);
  if (!inst) return;
  if (botUserIds && inst.bot_user_id && !botUserIds.includes(inst.bot_user_id)) return;
  const now = new Date().toISOString();
  await db.from("slack_installations").update({ status: "revoked", revoked_at: now, updated_at: now }).eq("id", inst.id);
  await dropSecret(inst.connection_id, db);
  await markConnection(inst.connection_id, "revoked", reason, db);
  await audit({ orgId: inst.org_id, action: "connection.revoked", target: "slack", detail: { team: inst.team_name, team_id: teamId, reason } }, db);
  forgetSlackClients();
}

/** Disconnect from Settings: uninstall the app from the workspace (best effort), then forget the token. */
export async function disconnectSlack(s: { orgId: string; projectId: string | null; userId: string }, db: SupabaseClient = serviceDb()): Promise<void> {
  const inst = await activeInstallation({ orgId: s.orgId }, db);
  if (!inst) return;
  const token = await readSecret(inst.connection_id, db).catch(() => null);
  if (token && process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET) {
    await slackCall(token, "apps.uninstall", { client_id: process.env.SLACK_CLIENT_ID, client_secret: process.env.SLACK_CLIENT_SECRET })
      .catch((e) => console.warn("[slack] apps.uninstall failed", e instanceof SlackError ? e.code : (e as Error).message));
  }
  await db.from("slack_installations").update({ status: "disconnected", updated_at: new Date().toISOString() }).eq("id", inst.id);
  await disconnect(inst.connection_id, db);
  await audit({ orgId: s.orgId, projectId: s.projectId, actorId: s.userId, action: "connection.disconnected", target: "slack", detail: { team: inst.team_name, team_id: inst.team_id } }, db);
  forgetSlackClients();
}
