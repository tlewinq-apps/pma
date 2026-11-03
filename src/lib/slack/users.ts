// Slack user -> PMA member, matched by email (users:read.email) and cached for a day. Only a match is cached:
// someone who isn't a member yet is looked up again on their next click, so signing in once lets them act at once.
// Slack people are per workspace: every row carries the workspace's team key (withSlack), so a user id from one
// workspace never reads or writes another workspace's cache.
import { serviceDb } from "@/lib/db/server";
import { env } from "@/lib/env";
import { slackApi } from "./api";
import { brand, teamKey } from "./context";
import { nameFromEmail } from "@/components/triage/format";

const TTL_MS = 24 * 60 * 60_000;

export type SlackPerson = { slackUserId: string; userId: string | null; email: string | null; name: string };

type SlackUser = { name?: string; real_name?: string; profile?: { email?: string; display_name?: string; real_name?: string } };
const slackName = (u: SlackUser, fallback: string) => u.profile?.display_name || u.profile?.real_name || u.real_name || u.name || fallback;

export async function resolveSlackUser(slackUserId: string, projectId: string): Promise<SlackPerson> {
  const db = serviceDb();
  const team = teamKey() ?? "";
  const { data: c } = await db.from("slack_users").select("user_id, email, name, checked_at").eq("team_id", team).eq("slack_user_id", slackUserId).maybeSingle();
  const cached = c ? { slackUserId, userId: c.user_id as string | null, email: c.email as string | null, name: (c.name as string | null) ?? slackUserId } : null;
  if (cached?.userId && Date.now() - Date.parse(c!.checked_at) < TTL_MS) return cached;
  let user: SlackUser;
  try {
    user = (await slackApi<{ user: SlackUser }>("users.info", { user: slackUserId })).user;
  } catch (e) {
    console.error("[slack] users.info failed", e);
    return cached ?? { slackUserId, userId: null, email: null, name: slackUserId };
  }
  const email = user.profile?.email ?? null;
  const name = slackName(user, slackUserId);
  const { data: userId } = email ? await db.rpc("member_by_email", { p_project: projectId, p_email: email }) : { data: null };
  const person = { slackUserId, userId: (userId as string | null) ?? null, email, name };
  await db.from("slack_users").upsert({ team_id: team, slack_user_id: slackUserId, user_id: person.userId, email, name, checked_at: new Date().toISOString() }, { onConflict: "team_id,slack_user_id" });
  return person;
}

/** Members whose Slack match was checked within the TTL, and the rest, who need a users.lookupByEmail. */
export function cachedSlackMatches<M extends { userId: string }>(members: M[], rows: { user_id: string | null; checked_at: string }[], now: number) {
  const fresh = new Set(rows.filter((r) => r.user_id && now - Date.parse(r.checked_at) < TTL_MS).map((r) => r.user_id));
  const matched = new Set(members.filter((m) => fresh.has(m.userId)).map((m) => m.userId));
  return { matched, lookUp: members.filter((m) => !matched.has(m.userId)) };
}

/**
 * Whether Slack knows each member's email (alerts are DMs, matched by email). A match is cached in slack_users for a
 * day; a member Slack doesn't know is checked again on every call, so joining Slack shows up on the next page load.
 */
export async function slackMatches(members: { userId: string; email: string }[]): Promise<Map<string, "matched" | "missing">> {
  const out = new Map<string, "matched" | "missing">();
  if (!members.length) return out;
  const db = serviceDb();
  const team = teamKey() ?? "";
  const { data: rows } = await db.from("slack_users").select("user_id, checked_at").eq("team_id", team).in("user_id", members.map((m) => m.userId));
  const { matched, lookUp } = cachedSlackMatches(members, rows ?? [], Date.now());
  for (const id of matched) out.set(id, "matched");
  await Promise.all(lookUp.map(async (m) => {
    let user: SlackUser & { id: string };
    try {
      user = (await slackApi<{ user: SlackUser & { id: string } }>("users.lookupByEmail", { email: m.email })).user;
    } catch {
      out.set(m.userId, "missing");
      return;
    }
    out.set(m.userId, "matched");
    await db.from("slack_users").upsert({ team_id: team, slack_user_id: user.id, user_id: m.userId, email: user.profile?.email ?? m.email, name: slackName(user, user.id), checked_at: new Date().toISOString() }, { onConflict: "team_id,slack_user_id" });
  }));
  return out;
}

/** Display names for PMA users: their Slack name in this workspace when known, else the email's local part. */
export async function displayNames(projectId: string, userIds: (string | null | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((u): u is string => !!u))];
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const db = serviceDb();
  const team = teamKey();
  if (team !== null) {
    const { data: slack } = await db.from("slack_users").select("user_id, name").eq("team_id", team).in("user_id", ids);
    for (const s of slack ?? []) if (s.user_id && s.name) out.set(s.user_id, s.name);
  }
  if (out.size < ids.length) {
    const { data: members } = await db.rpc("service_member_emails", { p_project: projectId });
    for (const m of (members ?? []) as { user_id: string; email: string }[]) if (!out.has(m.user_id) && ids.includes(m.user_id)) out.set(m.user_id, nameFromEmail(m.email));
  }
  return out;
}

export const notMemberText = (p: SlackPerson) =>
  p.email ? `${brand()} doesn't know ${p.email} yet. Sign in once at ${env.appUrl()} with this email, then press the button again.`
    : `${brand()} couldn't read your Slack email, so it can't match you to a ${brand()} member.`;
