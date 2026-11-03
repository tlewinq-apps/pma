import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { slackManifest } from "@/lib/slack/manifest";

it("the checked-in manifest matches the generator", () => {
  expect(JSON.parse(readFileSync("slack/manifest.json", "utf8"))).toEqual(slackManifest("https://YOUR-APP-URL"));
});
it("points both URLs at this app and asks only for the scopes it uses", () => {
  const m = slackManifest("https://pma.example.com/");
  expect(m.settings.event_subscriptions.request_url).toBe("https://pma.example.com/api/slack/events");
  expect(m.settings.interactivity.request_url).toBe("https://pma.example.com/api/slack/interactions");
  expect(m.settings.event_subscriptions.bot_events).toEqual(["message.channels", "message.groups", "app_home_opened", "app_uninstalled", "tokens_revoked"]);
  expect(m.oauth_config.scopes.bot).toContain("users:read.email");
  expect(m.oauth_config.scopes.bot).toContain("commands");
  expect(m.oauth_config.scopes.bot).not.toContain("chat:write.public");
});

it("can DM alerts: im:write, and a read-only Messages tab so people see them", () => {
  const m = slackManifest("https://pma.example.com");
  expect(m.oauth_config.scopes.bot).toContain("im:write");
  expect(m.features.app_home).toMatchObject({ messages_tab_enabled: true, messages_tab_read_only_enabled: true });
});

it("is one distributed app: OAuth comes back to this deployment and the scopes are frozen", () => {
  const m = slackManifest("https://pma.example.com/");
  expect(m.oauth_config.redirect_urls).toEqual(["https://pma.example.com/api/slack/oauth/callback"]);
  expect(m.oauth_config.scopes.bot).toEqual([
    "chat:write", "channels:history", "channels:read", "channels:join", "channels:manage", "pins:write", "users:read", "users:read.email",
    "commands", "im:write", "files:write", "groups:read", "groups:history", "groups:write",
  ]);
  expect(m.display_information.name).toBe("PMA");
  expect(m.settings.org_deploy_enabled).toBe(false);
});
