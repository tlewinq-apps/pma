// Which Slack workspace an app is on (src/lib/slack/tenant.ts and ownership.ts): its company's installation, the
// deployment's own workspace for demo apps that haven't installed through OAuth, or none. And what Settings says.
import { beforeEach, describe, it, expect, vi } from "vitest";
import { fakeDb } from "./fakeDb";

const h = vi.hoisted(() => ({ db: null as unknown, secrets: {} as Record<string, string>, slackApi: vi.fn() }));
vi.mock("@/lib/db/server", () => ({ serviceDb: () => h.db }));
vi.mock("@/lib/connections/store", async (orig) => ({ ...(await orig<typeof import("@/lib/connections/store")>()), readSecret: async (id: string) => h.secrets[id] ?? null }));
vi.mock("@/lib/slack/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/slack/api")>()),
  slackApi: h.slackApi,
  slackCall: async () => ({ team_id: "TLEGACY", user_id: "UBOT", url: "https://legacy.slack.com/", team: "Legacy" }),
}));

import { appsForSlack, forgetSlackClients, slackForProject, slackForTeam } from "@/lib/slack/tenant";
import { slackInviteFor, slackIsMine } from "@/lib/slack/ownership";
import { slackStatus } from "@/lib/slack/setup";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const DEMO = "00000000-0000-4000-8000-00000000000d";

function setTables(extra: Parameters<typeof fakeDb>[0] = {}) {
  h.db = fakeDb({
    projects: [
      { id: A, org_id: "org-a", kind: "customer", slug: "web", name: "Web", product_profile: null },
      { id: B, org_id: "org-b", kind: "customer", slug: "app", name: "App", product_profile: null },
      { id: DEMO, org_id: "org-demo", kind: "demo", slug: "celeste", name: "Celeste", product_profile: null },
    ],
    slack_installations: [{ id: "inst-a", org_id: "org-a", connection_id: "conn-a", team_id: "TA", team_name: "Acme", team_url: "https://acme.slack.com/", bot_user_id: "UA", status: "active" }],
    slack_channels: [{ project_id: A, role: "inbox", channel_id: "C1" }, { project_id: DEMO, role: "inbox", channel_id: "C9" }],
    ...extra,
  }).db;
}

beforeEach(() => {
  forgetSlackClients();
  h.secrets = { "conn-a": "xoxb-A" };
  h.slackApi.mockReset();
  vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-legacy");
  vi.stubEnv("SLACK_INVITE_URL", "https://join.slack.com/t/demo/shared_invite/x");
  vi.stubEnv("SLACK_CLIENT_ID", "");
  vi.stubEnv("SLACK_CLIENT_SECRET", "");
  vi.stubEnv("SLACK_SIGNING_SECRET", "s");
});

describe("finding an app's workspace", () => {
  it("a company with an installation uses its own token, with its team for slack_users", async () => {
    setTables();
    expect(await slackForProject(A)).toMatchObject({ token: "xoxb-A", teamKey: "TA", orgId: "org-a", legacy: false, team: { url: "https://acme.slack.com/", user_id: "UA" } });
  });

  it("a customer app without an installation has no Slack, even with the deployment's token set", async () => {
    setTables();
    expect(await slackForProject(B)).toBeNull();
  });

  it("the demo stays on the deployment's own workspace until its company installs", async () => {
    setTables();
    expect(await slackForProject(DEMO)).toMatchObject({ token: "xoxb-legacy", teamKey: "", legacy: true, orgId: null });
    forgetSlackClients();
    setTables({ slack_installations: [{ id: "inst-d", org_id: "org-demo", connection_id: "conn-d", team_id: "TLEGACY", status: "active" }] });
    h.secrets["conn-d"] = "xoxb-demo-oauth";
    expect(await slackForProject(DEMO)).toMatchObject({ token: "xoxb-demo-oauth", legacy: false });
  });

  it("a revoked installation's token is never used", async () => {
    setTables();
    delete h.secrets["conn-a"];
    expect(await slackForProject(A)).toBeNull();
  });
});

describe("routing by team", () => {
  it("finds the installation by team id, and the legacy workspace only for its own team", async () => {
    setTables();
    expect(await slackForTeam("TA")).toMatchObject({ token: "xoxb-A", orgId: "org-a" });
    expect(await slackForTeam("TLEGACY")).toMatchObject({ token: "xoxb-legacy", legacy: true });
    expect(await slackForTeam("TSOMEONE")).toBeNull();
    expect(await slackForTeam(null)).toBeNull();
  });

  it("a workspace serves its company's apps; the legacy one serves demo apps not yet installed", async () => {
    setTables();
    expect(await appsForSlack((await slackForTeam("TA"))!)).toEqual([A]);
    expect(await appsForSlack((await slackForTeam("TLEGACY"))!)).toEqual([DEMO]);
  });
});

describe("what people see", () => {
  it("an app has Slack when it reaches a workspace and has its channels", async () => {
    setTables();
    expect(await slackIsMine(A)).toBe(true);
    expect(await slackIsMine(B)).toBe(false);
    expect(await slackIsMine(DEMO)).toBe(true);
  });

  it("only an app on the deployment's own workspace offers its invite link", async () => {
    setTables();
    expect(await slackInviteFor(DEMO)).toMatch(/^https:\/\/join\.slack\.com/);
    expect(await slackInviteFor(A)).toBeNull();
    expect(await slackInviteFor(B)).toBeNull();
  });

  it("Settings: a customer app without Slack says what the deployment is missing, with no Slack call", async () => {
    setTables();
    expect(await slackStatus(B)).toMatchObject({ via: null, team: null, channels: [], missing: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"], roles: ["inbox", "cards"] });
    expect(h.slackApi).not.toHaveBeenCalled();
  });

  it("Settings: a connected app shows its own workspace and channels", async () => {
    setTables();
    h.slackApi.mockImplementation(async (method: string) => (method === "auth.test" ? { user: "pma" } : { channel: { name: "web-feedback" } }));
    expect(await slackStatus(A)).toMatchObject({ via: "installation", team: "Acme", bot: "pma", channels: [{ role: "inbox", name: "web-feedback", url: "https://acme.slack.com/archives/C1" }] });
  });
});
