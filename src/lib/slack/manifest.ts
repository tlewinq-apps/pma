// The Slack app manifest. `npm run slack:manifest` prints it with APP_URL filled in; paste it into
// api.slack.com/apps > Create New App > From a manifest. slack/manifest.json is the same with a placeholder URL.
// It is one distributed app: each company installs it in its own workspace with Add to Slack (OAuth v2, redirect URL
// below), so the scopes are frozen here. Adding a scope later makes every workspace reinstall.
import { SHORTCUT_SEND } from "./ids";

export const SLACK_SCOPES = [
  "chat:write", // cards, thread replies, the board
  "channels:history", // required for message.channels events
  "channels:read", // find an existing channel by name
  "channels:join", // reuse an existing channel
  "channels:manage", // create the channels and invite you
  "pins:write", // pin the board
  "users:read", "users:read.email", // match Slack people to PMA members by email
  "commands", // the Send to PMA message shortcut
  "im:write", // DM alerts (src/lib/alerts) when chat.postMessage to a user id needs an opened conversation
  "files:write", // mockup images uploaded into card threads (private storage)
  "groups:read", "groups:history", "groups:write", // private inbox and cards channels the company picks
] as const;

export const SLACK_BOT_EVENTS = ["message.channels", "message.groups", "app_home_opened", "app_uninstalled", "tokens_revoked"] as const;

export function slackManifest(appUrl: string) {
  const base = appUrl.replace(/\/+$/, "");
  return {
    _metadata: { major_version: 2, minor_version: 1 },
    display_information: { name: "PMA", description: "Feedback in, proposals and mockups out.", background_color: "#2753be" },
    features: {
      // Read-only Messages tab: alerts arrive as DMs from the app; replies happen in the issue threads.
      app_home: { home_tab_enabled: true, messages_tab_enabled: true, messages_tab_read_only_enabled: true },
      bot_user: { display_name: "pma", always_online: true },
      shortcuts: [{ name: "Send to PMA", type: "message", callback_id: SHORTCUT_SEND, description: "File this message as product feedback" }],
    },
    oauth_config: { redirect_urls: [`${base}/api/slack/oauth/callback`], scopes: { bot: [...SLACK_SCOPES] } },
    settings: {
      event_subscriptions: { request_url: `${base}/api/slack/events`, bot_events: [...SLACK_BOT_EVENTS] },
      interactivity: { is_enabled: true, request_url: `${base}/api/slack/interactions` },
      org_deploy_enabled: false, socket_mode_enabled: false, token_rotation_enabled: false,
    },
  };
}
