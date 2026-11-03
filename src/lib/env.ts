function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}
export const env = {
  supabaseUrl: () => req("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnon: () => req("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseService: () => req("SUPABASE_SERVICE_ROLE_KEY"),
  voyageKey: () => req("VOYAGE_API_KEY"),
  githubToken: () => req("GITHUB_TOKEN"),
  githubWebhookSecret: () => req("GITHUB_WEBHOOK_SECRET"),
  cronSecret: () => req("CRON_SECRET"),
  appUrl: () => process.env.APP_URL ?? "http://localhost:3000",
  slackSigningSecret: () => req("SLACK_SIGNING_SECRET"),
};
/** Voyage embeddings are optional: without a key, Claude picks issues and screens from full lists (see processSource). */
export const embeddingsEnabled = () => !!process.env.VOYAGE_API_KEY;
/** Recordings are transcribed by Deepgram. Without a key only the bundled sample recordings can be read. */
export const transcriptionEnabled = () => !!process.env.DEEPGRAM_API_KEY;
/**
 * Slack is set up on this deployment at all: the distributed app (client id and signing secret, so companies can Add to
 * Slack) or the deployment's own workspace (SLACK_BOT_TOKEN, the demo). Whether a given app has Slack is per app
 * (slackForProject in src/lib/slack/tenant.ts); this is only the cheap gate that skips Slack work entirely.
 */
export const slackEnabled = () => !!process.env.SLACK_BOT_TOKEN || (!!process.env.SLACK_CLIENT_ID && !!process.env.SLACK_SIGNING_SECRET);
/** Companies can install PMA's Slack app with Add to Slack (OAuth v2). */
export const slackOAuthEnabled = () => !!process.env.SLACK_CLIENT_ID && !!process.env.SLACK_CLIENT_SECRET && !!process.env.SLACK_SIGNING_SECRET;
/** The Slack workspace's shared invite link, for the Join Slack buttons; null unless it's an https URL. */
export function slackInviteUrl(): string | null {
  const v = process.env.SLACK_INVITE_URL?.trim();
  return v && /^https:\/\//.test(v) ? v : null;
}
