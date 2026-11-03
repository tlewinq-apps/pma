// Setting up an app's Slack channels from Settings or Start here: its status for the card, and the channels. A
// customer app has two, an inbox (feedback in) and a cards channel (one card per issue, its thread and the pinned
// board), which PMA creates or the admin picks from the workspace. The demo keeps its five legacy channels. Each
// channel gets its purpose and a pinned guide. Cards for open issues are posted afterwards by sweepSlack.
// Everything runs in the app's own workspace (inSlackFor), so an app never sees or touches another company's Slack.
import { serviceDb } from "@/lib/db/server";
import { env, slackEnabled } from "@/lib/env";
import { profileOf, type ProfileSource } from "@/lib/product/profile";
import { SlackError, slackApi, slackTeam } from "./api";
import { APP_CHANNEL_ROLES, CHANNEL_PURPOSE, CHANNEL_ROLES, appChannelGuide, appChannelPurpose, channelGuide, channelName, type ChannelRole, type SlackWording } from "./cards";
import { currentSlack } from "./context";
import { inSlackFor, legacySlack, slackForProject } from "./tenant";

export type SlackStatus = {
  /** Env settings this deployment lacks for Slack (the demo's legacy workspace, or Add to Slack for companies). */
  missing: string[];
  /** The workspace name and the bot's name, when the app has a workspace. */
  team: string | null; bot: string | null; error: string | null;
  channels: { role: ChannelRole; name: string; url: string | null }[];
  /** Why this app can't set up Slack yet, in a sentence; null when it can. */
  blocked: string | null;
  /** How this app reaches Slack: its company's installation, the deployment's own workspace (demo), or not at all. */
  via: "installation" | "legacy" | null;
  /** The channel roles this app uses. */
  roles: ChannelRole[];
};

type AppRow = ProfileSource & { id: string; slug: string };

async function appRow(projectId: string): Promise<AppRow | null> {
  const { data } = await serviceDb().from("projects").select("id, slug, kind, product_profile, name").eq("id", projectId).maybeSingle();
  return (data as AppRow | null) ?? null;
}

export const rolesFor = (kind: string): ChannelRole[] => [...(kind === "demo" ? CHANNEL_ROLES : APP_CHANNEL_ROLES)];
const wordingOf = (p: AppRow): SlackWording | null => (p.kind === "demo" ? null : { audience: profileOf(p).audience });

/** The Settings card's view of the app's Slack: its workspace and channels, or what's missing. */
export async function slackStatus(projectId: string): Promise<SlackStatus> {
  const p = await appRow(projectId);
  const roles = rolesFor(p?.kind ?? "customer");
  const status: SlackStatus = { missing: [], team: null, bot: null, error: null, channels: [], blocked: null, via: null, roles };
  if (!p) return { ...status, blocked: "This app couldn't be found." };
  const client = await slackForProject(projectId).catch(() => null);
  if (!client) {
    if (p.kind === "demo" && !legacySlack()) status.missing = ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"].filter((k) => !process.env[k]);
    else if (p.kind !== "demo") status.missing = ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_SIGNING_SECRET"].filter((k) => !process.env[k]);
    return status;
  }
  status.via = client.legacy ? "legacy" : "installation";
  await inSlackFor(projectId, async () => {
    try {
      const t = await slackTeam();
      // auth.test answers with the workspace's name as it is now; the installation keeps the name it had at install, so
      // a renamed workspace is written back here.
      const me = await slackApi<{ user: string; team?: string }>("auth.test");
      status.team = me.team || t.team; status.bot = me.user;
      const inst = currentSlack()?.installationId;
      if (inst && me.team && me.team !== t.team) await serviceDb().from("slack_installations").update({ team_name: me.team }).eq("id", inst);
      const { data } = await serviceDb().from("slack_channels").select("role, channel_id").eq("project_id", projectId);
      const known = [...roles, ...CHANNEL_ROLES.filter((r) => !roles.includes(r))];
      status.channels = await Promise.all(known.filter((r) => data?.some((d) => d.role === r)).map(async (role) => {
        const id = data!.find((d) => d.role === role)!.channel_id as string;
        const name = await slackApi<{ channel: { name: string } }>("conversations.info", { channel: id }).then((r) => r.channel.name, () => id);
        return { role, name, url: `${t.url.replace(/\/+$/, "")}/archives/${id}` };
      }));
    } catch (e) {
      status.error = e instanceof SlackError ? e.code : (e as Error).message;
    }
  });
  return status;
}

export type SlackChannelOption = { id: string; name: string; private: boolean; member: boolean };

/** Channels the admin can pick for the inbox and cards: public ones, and private ones the bot is already in. */
export async function listChannels(projectId: string): Promise<SlackChannelOption[] | null> {
  return inSlackFor(projectId, async () => {
    const out: SlackChannelOption[] = [];
    let cursor: string | undefined;
    do {
      const r = await slackApi<{ channels: { id: string; name: string; is_private?: boolean; is_member?: boolean; is_archived?: boolean }[]; response_metadata?: { next_cursor?: string } }>(
        "conversations.list", { types: "public_channel,private_channel", exclude_archived: true, limit: 1000, cursor });
      for (const c of r.channels) if (!c.is_archived && (!c.is_private || c.is_member)) out.push({ id: c.id, name: c.name, private: !!c.is_private, member: !!c.is_member });
      cursor = r.response_metadata?.next_cursor || undefined;
    } while (cursor && out.length < 5000);
    return out.sort((a, b) => a.name.localeCompare(b.name));
  });
}

async function findPublicChannel(name: string): Promise<string | null> {
  let cursor: string | undefined;
  do {
    const r = await slackApi<{ channels: { id: string; name: string }[]; response_metadata?: { next_cursor?: string } }>("conversations.list", { types: "public_channel", exclude_archived: true, limit: 1000, cursor });
    const hit = r.channels.find((c) => c.name === name);
    if (hit) return hit.id;
    cursor = r.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return null;
}

const SETUP_HINTS: Record<string, string> = {
  missing_scope: "The Slack app is missing a scope. Reinstall it with Connect to Slack.",
  invalid_auth: "Slack no longer accepts PMA's token for this workspace. Connect to Slack again.",
  token_revoked: "Slack no longer accepts PMA's token for this workspace. Connect to Slack again.",
  restricted_action: "This workspace doesn't let apps create channels. Create them yourself, then pick them here.",
  channel_not_found: "That channel isn't in this workspace any more. Pick another.",
};
const setupError = (e: unknown) => {
  const code = e instanceof SlackError ? e.code : (e as Error).message;
  return SETUP_HINTS[code] ?? `Slack said: ${code}`;
};

/** Invites the person who set it up to each channel (best effort: someone without a Slack match is skipped). */
async function inviteTo(ids: string[], email: string | null): Promise<void> {
  if (!email) return;
  const me = await slackApi<{ user: { id: string } }>("users.lookupByEmail", { email }).then((r) => r.user.id, () => null);
  const team = await slackTeam();
  if (!me || me === team.user_id) return;
  for (const channel of ids) {
    await slackApi("conversations.invite", { channel, users: me }).catch((e) => {
      if (!(e instanceof SlackError && ["already_in_channel", "cant_invite_self", "not_in_channel"].includes(e.code))) throw e;
    });
  }
}

/** Saves the app's channels. When they moved, the app's cards and message refs start over (old channels keep history). */
async function saveChannels(projectId: string, ids: Partial<Record<ChannelRole, string>>, roles: ChannelRole[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = serviceDb();
  const { data: before } = await db.from("slack_channels").select("role, channel_id").eq("project_id", projectId);
  const moved = !before?.length || before.length !== roles.length || before.some((b) => ids[b.role as ChannelRole] !== b.channel_id);
  if (!moved) return { ok: true };
  const { data: taken } = await db.from("slack_channels").select("project_id, channel_id").in("channel_id", roles.map((r) => ids[r]!)).neq("project_id", projectId);
  if (taken?.length) return { ok: false, error: "One of those channels is already used by another app. Pick another." };
  const { data: issues } = await db.from("issues").select("id").eq("project_id", projectId);
  const issueIds = (issues ?? []).map((i) => i.id as string);
  if (issueIds.length) await db.from("slack_threads").delete().in("issue_id", issueIds);
  await db.from("slack_posts").delete().eq("project_id", projectId);
  await db.from("slack_channels").delete().eq("project_id", projectId);
  const { error } = await db.from("slack_channels").insert(roles.map((role) => ({ project_id: projectId, role, channel_id: ids[role]! })));
  return error ? { ok: false, error: error.code === "23505" ? "One of those channels is already used by another app. Pick another." : error.message } : { ok: true };
}

/** Creates the app's channels (or reuses public ones with the same names) and invites `inviteEmail` to them. */
export async function createChannels(projectId: string, prefix: string, inviteEmail: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const p = await appRow(projectId);
  if (!p) return { ok: false, error: "This app couldn't be found." };
  const roles = rolesFor(p.kind);
  const r = await inSlackFor(projectId, async () => {
    try {
      const ids = {} as Record<ChannelRole, string>;
      for (const role of roles) {
        const name = channelName(prefix, role);
        try {
          ids[role] = (await slackApi<{ channel: { id: string } }>("conversations.create", { name, is_private: false })).channel.id;
        } catch (e) {
          if (!(e instanceof SlackError && e.code === "name_taken")) throw e;
          const found = await findPublicChannel(name);
          if (!found) return { ok: false as const, error: `#${name} already exists but is private or archived. Pick another prefix, or pick channels instead.` };
          await slackApi("conversations.join", { channel: found });
          ids[role] = found;
        }
      }
      await inviteTo(roles.map((r) => ids[r]), inviteEmail);
      const saved = await saveChannels(projectId, ids, roles);
      if (!saved.ok) return saved;
      await explainChannels(projectId, ids, p);
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: setupError(e) };
    }
  });
  return r ?? { ok: false, error: "Connect to Slack first." };
}

/**
 * Uses channels the admin picked: a public channel is joined; a private one must already have the PMA bot in it.
 * Only for apps with an inbox and a cards channel (customer apps).
 */
export async function pickChannels(projectId: string, picked: { inbox: string; cards: string }, inviteEmail: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const p = await appRow(projectId);
  if (!p) return { ok: false, error: "This app couldn't be found." };
  if (p.kind === "demo") return { ok: false, error: "The demo uses its own channels. Press Create channels." };
  if (picked.inbox === picked.cards) return { ok: false, error: "Pick two different channels: one for feedback, one for the cards." };
  const r = await inSlackFor(projectId, async () => {
    try {
      for (const id of [picked.inbox, picked.cards]) {
        const info = (await slackApi<{ channel: { id: string; is_private?: boolean; is_member?: boolean; is_archived?: boolean; name: string } }>("conversations.info", { channel: id })).channel;
        if (info.is_archived) return { ok: false as const, error: `#${info.name} is archived. Pick another channel.` };
        if (info.is_private && !info.is_member) return { ok: false as const, error: `#${info.name} is private. Invite the PMA app to it in Slack first, then pick it again.` };
        if (!info.is_private && !info.is_member) await slackApi("conversations.join", { channel: id });
      }
      const ids = { inbox: picked.inbox, cards: picked.cards } as Record<ChannelRole, string>;
      await inviteTo([picked.inbox, picked.cards], inviteEmail);
      const saved = await saveChannels(projectId, ids, ["inbox", "cards"]);
      if (!saved.ok) return saved;
      await explainChannels(projectId, ids, p);
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: setupError(e) };
    }
  });
  return r ?? { ok: false, error: "Connect to Slack first." };
}

/**
 * Gives each channel its purpose line and one pinned "How this channel works" message, so someone who joins knows
 * what to do there. The guide is edited in place when it exists (ref guide:<role>), so setting the channels up again
 * refreshes it. Runs in the app's workspace. Best effort: a channel that refuses keeps working without it.
 */
export async function explainChannels(projectId: string, ids: Partial<Record<ChannelRole, string>>, p: ProfileSource): Promise<void> {
  if (!currentSlack()) return;
  const db = serviceDb();
  const wording = p.kind === "demo" ? null : wordingOf(p as AppRow);
  for (const role of Object.keys(ids) as ChannelRole[]) {
    const channel = ids[role]!;
    try {
      const purpose = wording ? appChannelPurpose(role, wording) : CHANNEL_PURPOSE[role];
      await slackApi("conversations.setPurpose", { channel, purpose }).catch((e) => console.warn("[slack] purpose failed", role, e));
      const msg = wording ? appChannelGuide(role, env.appUrl(), wording, ids.cards ?? null) : channelGuide(role, env.appUrl());
      const ref = `guide:${role}`;
      const { data: had } = await db.from("slack_posts").select("channel_id, ts").eq("project_id", projectId).eq("ref", ref).maybeSingle();
      if (had?.channel_id === channel) {
        try { await slackApi("chat.update", { channel, ts: had.ts, ...msg }); continue; } catch (e) { if (!(e instanceof SlackError && e.code === "message_not_found")) throw e; }
      }
      const { ts } = await slackApi<{ ts: string }>("chat.postMessage", { channel, ...msg, unfurl_links: false, unfurl_media: false });
      await slackApi("pins.add", { channel, timestamp: ts }).catch((e) => console.warn("[slack] pin guide failed", role, e));
      await db.from("slack_posts").upsert({ project_id: projectId, ref, channel_id: channel, ts }, { onConflict: "project_id,ref" });
    } catch (e) {
      console.warn("[slack] channel guide failed", role, e);
    }
  }
}

/** Whether Slack can be offered on this deployment at all (for the cards' copy). */
export const slackOffered = () => slackEnabled();
