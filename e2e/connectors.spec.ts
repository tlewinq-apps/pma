// The connectors end to end, on fakes: e2e-other's admin adds the Claude key, connects Slack (OAuth), Marver, PostHog,
// Granola and GitHub from Start here and Settings, and each one's data flows into the app. Nothing real is called: the
// dev server runs against e2e/fakes/connectors.ts. It needs its own dev server, started with
//
//   node --import tsx e2e/fakes/connectors.ts      (port 4787; writes e2e/.github-app.env, a throwaway App key)
//   APP_URL=https://connectors-e2e.example SLACK_API_URL=http://localhost:4787/slack/api \
//   POSTHOG_API_URL=http://localhost:4787/posthog GRANOLA_API_URL=http://localhost:4787/granola \
//   ANTHROPIC_BASE_URL=http://localhost:4787/anthropic SLACK_CLIENT_ID=e2e.client SLACK_CLIENT_SECRET=e2e-secret \
//   SLACK_SIGNING_SECRET=e2e-signing-secret GITHUB_API_URL=http://localhost:4787/github \
//   GITHUB_WEB_URL=http://localhost:4787/githubweb VOYAGE_API_KEY= \
//   sh -c 'set -a; . e2e/.github-app.env; set +a; exec npx next dev -p 3007'
//
// (next dev passes its own node flags to a child process, so the key file is loaded by the shell, not --env-file.)
//
// then E2E_URL=http://localhost:3007 E2E_FAKES=http://localhost:4787 npx playwright test e2e/connectors.spec.ts.
// It skips without E2E_FAKES. Everything it connects is removed afterwards.
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isProdUrl } from "../scripts/lib/guard";
import { FAKE, type FakeCall } from "./fakes/connectors";
import { signStandardWebhook } from "../src/lib/granola/webhook";

type Fixtures = { OTHER_ORG: string; OTHER_APP: string; OTHER_ORG_APP_ID: string; OTHER_ORG_ISSUE_ID: string };
const fx = (): Fixtures => JSON.parse(readFileSync("e2e/.fixtures.json", "utf8"));
const FAKES = process.env.E2E_FAKES;
const SIGNING = "e2e-signing-secret";
const CANVAS = ".local-repos/e2e-fake/canvas";

function db(): SupabaseClient {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || isProdUrl(url)) throw new Error("e2e/connectors.spec.ts runs on the dev Supabase project only.");
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}

const calls = async (): Promise<FakeCall[]> => (await fetch(`${FAKES}/_calls`)).json();
const orgOf = async () => (await db().from("projects").select("org_id").eq("id", fx().OTHER_ORG_APP_ID).single()).data!.org_id as string;

/** Removes everything a run connected for e2e-other, and what came in through it. */
async function clean() {
  const s = db();
  const { OTHER_ORG_APP_ID: app } = fx();
  const org = await orgOf();
  await s.from("slack_installations").delete().eq("org_id", org);
  await s.from("connections").delete().eq("org_id", org); // the delete trigger drops each Vault secret
  await s.from("slack_channels").delete().eq("project_id", app);
  await s.from("slack_posts").delete().eq("project_id", app);
  const { data: issues } = await s.from("issues").select("id").eq("project_id", app);
  if (issues?.length) await s.from("slack_threads").delete().in("issue_id", issues.map((i) => i.id));
  await s.from("issue_signals").delete().eq("project_id", app);
  await s.from("issue_links").delete().eq("project_id", app);
  await s.from("sources").delete().eq("project_id", app).in("kind", ["slack", "granola"]);
  await s.from("screens").delete().eq("project_id", app);
  await s.from("audit_log").delete().eq("org_id", org);
}

/** A Slack Events API delivery, signed like Slack signs it. */
async function slackEvent(request: APIRequestContext, body: object) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = `v0=${createHmac("sha256", SIGNING).update(`v0:${ts}:${raw}`).digest("hex")}`;
  return request.post("/api/slack/events", { data: raw, headers: { "content-type": "application/json", "x-slack-request-timestamp": ts, "x-slack-signature": sig } });
}

test.describe("connectors on fakes", () => {
  test.skip(!FAKES, "Needs the fake connectors and a dev server pointed at them (see the top of this file).");
  test.use({ storageState: "e2e/.auth/other-admin.json" });
  test.describe.configure({ mode: "serial" });

  let before: { repo_full_name: string | null; watched_branch: string | null; design_path: string | null };
  test.beforeAll(async () => {
    const { data } = await db().from("projects").select("repo_full_name, watched_branch, design_path").eq("id", fx().OTHER_ORG_APP_ID).single();
    before = data!;
    await clean();
    await fetch(`${FAKES}/_reset`);
    // A Marver canvas in a local checkout (git-ignored; read only outside production).
    mkdirSync(`${CANVAS}/design/scenes/checkout`, { recursive: true });
    writeFileSync(`${CANVAS}/design/manifest.json`, JSON.stringify({ frames: [{ id: "checkout/index", scene: "checkout", file: "design/scenes/checkout/index.tsx", kind: "tsx", title: "Checkout" }] }));
    writeFileSync(`${CANVAS}/design/scenes/checkout/index.tsx`, "export default function Checkout() { return <main><h1>Checkout</h1><button>Pay</button></main>; }\n");
  });
  test.afterAll(async () => {
    await clean();
    await db().from("projects").update(before).eq("id", fx().OTHER_ORG_APP_ID);
    rmSync(".local-repos/e2e-fake", { recursive: true, force: true });
  });

  test("Start here: the Claude key is a required step, and the tools open once the repository and key are in", async ({ page }) => {
    const { OTHER_ORG, OTHER_APP, OTHER_ORG_APP_ID } = fx();
    await db().from("projects").update({ repo_full_name: null }).eq("id", OTHER_ORG_APP_ID);
    const welcome = `/${OTHER_ORG}/${OTHER_APP}/welcome`;
    const step = page.locator("section[aria-labelledby='setup-step-title']");
    for (const tool of ["slack", "sentry", "posthog", "granola", "marver"]) {
      await page.goto(`${welcome}?step=${tool}`);
      await expect(step.getByText("This opens once your repository and Claude key are in.")).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Connect to Slack" })).toHaveCount(0);

    await db().from("projects").update({ repo_full_name: "e2e-fake/canvas", watched_branch: "main" }).eq("id", OTHER_ORG_APP_ID);
    const key = `sk-ant-e2e-${"k".repeat(28)}last`;
    await page.goto(`${welcome}?step=claude`);
    await step.getByLabel("Claude API key").fill(key);
    await step.getByRole("button", { name: "Add your Claude API key" }).click();
    await expect(step.getByText("Saved. PMA now uses your key ending in last.")).toBeVisible();
    // The step turns done in place: its tick, and Continue instead of Do this later.
    await expect(step.getByRole("status").filter({ hasText: "Using your key ending in last" })).toBeVisible();
    await expect(step.getByRole("link", { name: "Continue" })).toBeVisible();
    for (const [tool, name] of [["slack", "Connect to Slack"], ["posthog", "Connect to PostHog"]]) {
      await page.goto(`${welcome}?step=${tool}`);
      await expect(step.getByRole("link", { name })).toBeVisible();
    }
    for (const [tool, name] of [["marver", "Use the canvas in e2e-fake/canvas/design"], ["granola", "Connect to Granola"]]) {
      await page.goto(`${welcome}?step=${tool}`);
      await expect(step.getByRole("button", { name })).toBeVisible();
    }

    // Checked with Anthropic (the fake) before it was saved: the models list, then a one-token Haiku call.
    const anthropic = (await calls()).filter((c) => c.service === "anthropic");
    expect(anthropic.map((c) => `${c.method} ${c.path.split("?")[0]}`)).toEqual(["GET /v1/models", "POST /v1/messages"]);
    expect(anthropic.every((c) => c.auth === `x-api-key ${key}`)).toBe(true);
    expect(anthropic[1].body).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 1 });
    // The key is in Vault, never in the row.
    const { data: conn } = await db().from("connections").select("id, status, display, config, secret_id").eq("org_id", await orgOf()).eq("kind", "anthropic").single();
    expect(conn).toMatchObject({ status: "ok", display: { last4: "last" } });
    expect(JSON.stringify(conn)).not.toContain(key);
    expect((await db().rpc("connection_secret_get", { p_connection: conn!.id })).data).toBe(key);
  });

  test("Slack: Add to Slack, two channels, events routed by workspace, and an uninstall", async ({ page, request }) => {
    const { OTHER_ORG, OTHER_APP, OTHER_ORG_APP_ID } = fx();
    const install = await request.get(`/api/slack/install?app=${OTHER_ORG_APP_ID}&return=${encodeURIComponent(`/${OTHER_ORG}/${OTHER_APP}/settings#connections`)}`, { maxRedirects: 0 });
    expect(install.status()).toBe(307);
    const consent = new URL(install.headers().location);
    expect(consent.origin + consent.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(consent.searchParams.get("client_id")).toBe("e2e.client");
    expect(consent.searchParams.get("redirect_uri")).toBe("https://connectors-e2e.example/api/slack/oauth/callback");
    expect(consent.searchParams.get("scope")).toContain("groups:write");
    // Slack would send the person back with a code; the fake accepts any code but "bad".
    await page.goto(`/api/slack/oauth/callback?code=e2e&state=${consent.searchParams.get("state")}`);
    await expect(page).toHaveURL(new RegExp(`/${OTHER_ORG}/${OTHER_APP}/settings\\?connect=slack&ok=1`));
    const card = page.getByRole("region", { name: "Slack" });
    await expect(card.getByText("Slack is connected.")).toBeVisible();
    await expect(card.getByText("Needs attention")).toBeVisible();
    // The state was single use.
    const again = await request.get(`/api/slack/oauth/callback?code=e2e&state=${consent.searchParams.get("state")}`, { maxRedirects: 0 });
    expect(again.headers().location).toMatch(/connect=slack&error=unknown/);

    await page.goto(`/${OTHER_ORG}/${OTHER_APP}/settings`);
    await card.getByRole("button", { name: "Create channels" }).click();
    await expect(card.getByText("Channels ready.")).toBeVisible();
    await expect(card.getByText("Connected", { exact: true })).toBeVisible();
    const s = db();
    const { data: inst } = await s.from("slack_installations").select("team_id, status, org_id").eq("org_id", await orgOf()).single();
    expect(inst).toMatchObject({ team_id: FAKE.slack.team, status: "active" });
    const { data: channels } = await s.from("slack_channels").select("role, channel_id").eq("project_id", OTHER_ORG_APP_ID).order("role");
    expect(channels!.map((c) => c.role)).toEqual(["cards", "inbox"]);
    const inbox = channels!.find((c) => c.role === "inbox")!.channel_id as string;

    // A message in the inbox from this workspace is filed into this app; the same channel from another workspace is not.
    const ts = `${Math.floor(Date.now() / 1000)}.000100`;
    const message = (team: string, at: string) => ({ type: "event_callback", team_id: team, event: { type: "message", channel: inbox, user: "USAM", text: "The pay button does nothing on my phone", ts: at } });
    expect((await slackEvent(request, message("TSOMEONEELSE", `${ts}1`))).status()).toBe(200);
    expect((await slackEvent(request, message(FAKE.slack.team, ts))).status()).toBe(200);
    await expect.poll(async () => (await s.from("sources").select("id").eq("project_id", OTHER_ORG_APP_ID).eq("kind", "slack").eq("metadata->slack->>ts", ts)).data?.length, { timeout: 20_000 }).toBe(1);
    expect((await s.from("sources").select("id").eq("metadata->slack->>ts", `${ts}1`)).data).toEqual([]);
    // Every Slack call carried this company's bot token.
    const slackCalls = (await calls()).filter((c) => c.service === "slack" && !c.path.includes("oauth.v2.access"));
    expect(slackCalls.length).toBeGreaterThan(3);
    expect(slackCalls.every((c) => c.auth === `Bearer ${FAKE.slack.token}`)).toBe(true);

    // Uninstalled in Slack: the connection is revoked and the token forgotten.
    expect((await slackEvent(request, { type: "event_callback", team_id: FAKE.slack.team, event: { type: "app_uninstalled" } })).status()).toBe(200);
    await expect.poll(async () => (await s.from("slack_installations").select("status").eq("org_id", await orgOf()).single()).data?.status, { timeout: 20_000 }).toBe("revoked");
    await expect.poll(async () => (await s.from("connections").select("status, secret_id").eq("org_id", await orgOf()).eq("kind", "slack").single()).data, { timeout: 20_000 })
      .toEqual({ status: "revoked", secret_id: null });
    await page.reload();
    await expect(card.getByText("Needs attention")).toBeVisible();
  });

  test("Marver: one click connects the canvas in the app's repository, and its screens sync", async ({ page }) => {
    const { OTHER_ORG, OTHER_APP, OTHER_ORG_APP_ID } = fx();
    await page.goto(`/${OTHER_ORG}/${OTHER_APP}/settings`);
    const card = page.getByRole("region", { name: "Marver" });
    // The app's repository is e2e-fake/canvas (the Claude key test set it), so its design folder is one click.
    await expect(card.getByLabel("Repository with the canvas")).toHaveCount(0);
    await card.getByRole("button", { name: "Use the canvas in e2e-fake/canvas/design" }).click();
    await expect(card.getByText("Connected. 1 screens and 0 flows synced.")).toBeVisible({ timeout: 60_000 });
    await expect(card.getByText("Connected", { exact: true })).toBeVisible();
    const { data: screens } = await db().from("screens").select("frame_id, title").eq("project_id", OTHER_ORG_APP_ID);
    expect(screens).toEqual([{ frame_id: "checkout/index", title: "Checkout" }]);
  });

  test("PostHog: a personal key, the project checked, numbers synced, and an error linked on an issue", async ({ page }) => {
    const { OTHER_ORG, OTHER_APP, OTHER_ORG_APP_ID, OTHER_ORG_ISSUE_ID } = fx();
    const key = `phx_e2e${"p".repeat(30)}`;
    await page.goto(`/${OTHER_ORG}/${OTHER_APP}/settings`);
    const card = page.getByRole("region", { name: "PostHog" });
    await card.getByRole("button", { name: "Use a personal API key instead" }).click();
    await card.getByLabel("PostHog personal API key").fill(key);
    await card.getByRole("button", { name: "Connect with the key" }).click();
    await expect(card.getByText(`Connected to ${FAKE.posthog.project}.`, { exact: false })).toBeVisible();
    const s = db();
    await expect.poll(async () => (await s.from("issue_signals").select("kind, key, users_30d").eq("project_id", OTHER_ORG_APP_ID).order("kind")).data, { timeout: 20_000 })
      .toEqual([{ kind: "pageview", key: "/checkout", users_30d: 120 }, { kind: "rageclick", key: "/checkout/pay", users_30d: 9 }]);
    const ph = (await calls()).filter((c) => c.service === "posthog");
    expect(ph.map((c) => `${c.method} ${c.path}`)).toEqual(expect.arrayContaining(["GET /api/projects/", `GET /api/projects/${FAKE.posthog.projectId}/`, `POST /api/projects/${FAKE.posthog.projectId}/query/`]));
    expect(ph.every((c) => c.auth === `Bearer ${key}`)).toBe(true);

    await page.goto(`/${OTHER_ORG}/${OTHER_APP}/issues/${OTHER_ORG_ISSUE_ID}`);
    const panel = page.getByRole("region", { name: "PostHog" });
    await expect(panel.getByText("No PostHog error is linked to this issue yet.")).toBeVisible();
    await panel.getByRole("button", { name: "Link a PostHog error" }).click();
    await expect(panel.getByText("TypeError: Cannot read total of undefined in Checkout")).toBeVisible();
    await panel.getByRole("button", { name: "Link", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Unlink" })).toBeVisible();
    const { data: links } = await s.from("issue_links").select("external_id, issue_id").eq("project_id", OTHER_ORG_APP_ID);
    expect(links).toEqual([{ external_id: FAKE.posthog.errorId, issue_id: OTHER_ORG_ISSUE_ID }]);
  });

  test("Granola: a key, a webhook for this company, and a signed note arriving as feedback", async ({ page, request }) => {
    const { OTHER_ORG, OTHER_APP, OTHER_ORG_APP_ID } = fx();
    const key = `grn_e2e${"g".repeat(24)}`;
    await page.goto(`/${OTHER_ORG}/${OTHER_APP}/welcome?step=granola`);
    const card = page.getByRole("region", { name: "Granola" });
    await card.getByLabel("Granola API key").fill(key);
    await card.getByRole("button", { name: "Connect to Granola" }).click();
    await expect(card.getByText("Connected. New notes arrive within a minute", { exact: false })).toBeVisible();
    const s = db();
    const { data: conn } = await s.from("connections").select("id, status, config").eq("org_id", await orgOf()).eq("kind", "granola").single();
    expect(conn).toMatchObject({ status: "ok", config: { webhook_id: FAKE.granola.webhookId, default_project_id: OTHER_ORG_APP_ID } });
    const registered = (await calls()).find((c) => c.service === "granola" && c.method === "POST");
    expect(registered?.body).toMatchObject({ url: `https://connectors-e2e.example/api/granola/webhook/${conn!.id}`, events: ["note.generated", "note.access_granted"] });

    // The catch-up brought in the last four days' note; take it away so the webhook brings it again.
    const noteSources = () => s.from("sources").select("id, kind, author, channel").eq("project_id", OTHER_ORG_APP_ID).eq("kind", "granola");
    await expect.poll(async () => (await noteSources()).data?.length, { timeout: 20_000 }).toBe(1);
    await s.from("sources").delete().eq("project_id", OTHER_ORG_APP_ID).eq("kind", "granola");

    const body = JSON.stringify({ event_id: "evt_e2e", event_type: "note.generated", note_id: FAKE.granola.noteId, occurred_at: new Date().toISOString() });
    const at = String(Math.floor(Date.now() / 1000));
    const url = `/api/granola/webhook/${conn!.id}`;
    const forged = await request.post(url, { data: body, headers: { "content-type": "application/json", "webhook-id": "evt_e2e", "webhook-timestamp": at, "webhook-signature": "v1,Zm9yZ2Vk" } });
    expect(forged.status()).toBe(401);
    const ok = await request.post(url, { data: body, headers: { "content-type": "application/json", "webhook-id": "evt_e2e", "webhook-timestamp": at, "webhook-signature": signStandardWebhook(FAKE.granola.secret, "evt_e2e", at, body) } });
    expect(ok.status()).toBe(200);
    await expect.poll(async () => (await noteSources()).data, { timeout: 20_000 }).toEqual([expect.objectContaining({ kind: "granola", author: "Priya PM", channel: "Granola: E2E customer call" })]);
  });

  test("GitHub: Connect with GitHub, the installation checked as the person's own, and a private repository picked and read", async ({ page, request }) => {
    const { OTHER_ORG, OTHER_APP, OTHER_ORG_APP_ID } = fx();
    // No repository yet, so Start here leads with Connect with GitHub (watched_branch can't be null; it stays).
    const cleared = await db().from("projects").update({ repo_full_name: null }).eq("id", OTHER_ORG_APP_ID);
    expect(cleared.error).toBeNull();
    const back = `/${OTHER_ORG}/${OTHER_APP}/welcome?step=github`;
    const start = async () => {
      const install = await request.get(`/api/github/install?app=${OTHER_ORG_APP_ID}&return=${encodeURIComponent(back)}`, { maxRedirects: 0 });
      expect(install.status()).toBe(307);
      const to = new URL(install.headers().location);
      expect(to.pathname).toBe(`/githubweb/apps/${FAKE.github.slug}/installations/new`);
      return to.searchParams.get("state")!;
    };
    /** GitHub's setup redirect, then its sign-in (PKCE) coming back with a code: what the person's browser would do. */
    const finish = async (installationId: number) => {
      const setup = await request.get(`/api/github/setup?installation_id=${installationId}&setup_action=install&state=${await start()}`, { maxRedirects: 0 });
      const signIn = new URL(setup.headers().location);
      expect(signIn.pathname).toBe("/githubweb/login/oauth/authorize");
      expect(signIn.searchParams.get("code_challenge_method")).toBe("S256");
      await page.goto(`/api/github/callback?code=e2e&state=${signIn.searchParams.get("state")}`);
    };

    // An installation id the person's GitHub doesn't list (a forged setup URL) is refused, and nothing is saved.
    await finish(999);
    await expect(page).toHaveURL(new RegExp(`/${OTHER_ORG}/${OTHER_APP}/welcome\\?step=github&connect=github&error=not_yours`));
    await expect(page.getByText("GitHub didn't list that installation for your account.", { exact: false })).toBeVisible();
    expect((await db().from("connections").select("status").eq("org_id", await orgOf()).eq("kind", "github").eq("status", "ok")).data).toEqual([]);

    await finish(FAKE.github.installation);
    await expect(page).toHaveURL(new RegExp(`/${OTHER_ORG}/${OTHER_APP}/welcome\\?step=github&connect=github&ok=1`));
    const list = page.locator("section[aria-labelledby='setup-step-title']");
    await expect(list.getByText(`GitHub is connected through ${FAKE.github.account}`, { exact: false })).toBeVisible();
    const { data: conn } = await db().from("connections").select("status, external_id, display, secret_id").eq("org_id", await orgOf()).eq("kind", "github").single();
    expect(conn).toMatchObject({ status: "ok", external_id: String(FAKE.github.installation), display: { account: FAKE.github.account }, secret_id: null });

    // The picker lists the installation's repositories; the private one connects and is read with the installation token.
    await expect(list.getByLabel("Repository")).toHaveValue(FAKE.github.repo);
    await list.getByRole("button", { name: "Connect repository" }).click();
    await expect(list.getByText("Connected. PMA can read", { exact: false })).toBeVisible({ timeout: 30_000 });
    const { data: app } = await db().from("projects").select("repo_full_name, watched_branch").eq("id", OTHER_ORG_APP_ID).single();
    expect(app).toEqual({ repo_full_name: FAKE.github.repo, watched_branch: "main" });
    const github = (await calls()).filter((c) => c.service === "github");
    expect(github.find((c) => c.path === `/repos/${FAKE.github.repo}/tarball/main`)?.auth).toBe(`Bearer ${FAKE.github.installToken}`);
    expect(github.find((c) => c.path.startsWith("/user/installations"))?.auth).toBe(`Bearer ${FAKE.github.userToken}`);
  });

  test("Build it: Claude writes the change on the private repository, PMA opens and links the pull request, and its merge ships the issue", async ({ request }) => {
    const { OTHER_ORG_ISSUE_ID } = fx();
    const s = db();
    // The GitHub test connected e2e-org/private-app through the installation, with write access accepted.
    const { data: issueBefore } = await s.from("issues").select("status, short_id").eq("id", OTHER_ORG_ISSUE_ID).single();
    const { data: solution } = await s.from("solutions").insert({ issue_id: OTHER_ORG_ISSUE_ID, rank: 1, title: "Make the pay button submit", summary: "The pay button submits the checkout form.", recommended: true }).select("id").single();
    await s.from("issues").update({ status: "ready_to_build" }).eq("id", OTHER_ORG_ISSUE_ID);
    try {
      const started = await request.post(`/api/issues/${OTHER_ORG_ISSUE_ID}/build`, { data: { mode: "new_pr" } });
      expect(started.status(), await started.text()).toBe(200);
      const { id: buildId } = await started.json() as { id: string };
      await expect.poll(async () => (await s.from("builds").select("status, error").eq("id", buildId).single()).data, { timeout: 60_000 })
        .toMatchObject({ status: "opened" });
      const { data: build } = await s.from("builds").select("pr_number, files, head_branch, base_branch, commit_sha, steps").eq("id", buildId).single();
      expect(build).toMatchObject({ pr_number: FAKE.github.pr, files: [FAKE.build.path], base_branch: "main", commit_sha: "e2ecommit0new" });
      expect(build!.head_branch).toMatch(new RegExp(`^pma/${issueBefore!.short_id.toLowerCase()}-build-`));

      // GitHub saw one tree with the change, on the base, all as the installation; the pull request carries the marker.
      const github = (await calls()).filter((c) => c.service === "github" && c.path.startsWith(`/repos/${FAKE.github.repo}/`));
      expect(github.every((c) => c.auth === `Bearer ${FAKE.github.installToken}`)).toBe(true);
      const tree = github.find((c) => c.method === "POST" && c.path === `/repos/${FAKE.github.repo}/git/trees`)!.body as { base_tree: string; tree: { path: string; content: string }[] };
      expect(tree).toEqual({ base_tree: "e2etree0base", tree: [{ path: FAKE.build.path, mode: "100644", type: "blob", content: FAKE.build.content }] });
      const pull = github.find((c) => c.method === "POST" && c.path === `/repos/${FAKE.github.repo}/pulls`)!.body as { title: string; base: string; body: string };
      expect(pull.title).toBe(FAKE.build.title);
      expect(pull.base).toBe("main");
      expect(pull.body.trim().endsWith(`PMA: ${issueBefore!.short_id}`)).toBe(true);
      const { data: links } = await s.from("pull_request_links").select("url, number, state").eq("issue_id", OTHER_ORG_ISSUE_ID);
      expect(links).toEqual([{ url: `https://github.com/${FAKE.github.repo}/pull/${FAKE.github.pr}`, number: FAKE.github.pr, state: "open" }]);

      // The merge, as GitHub delivers it to the App: the issue ships, by GitHub.
      const body = JSON.stringify({ action: "closed", installation: { id: FAKE.github.installation }, repository: { full_name: FAKE.github.repo }, pull_request: { number: FAKE.github.pr, merged: true, body: pull.body } });
      const sig = `sha256=${createHmac("sha256", FAKE.github.webhookSecret).update(body).digest("hex")}`;
      const delivered = await request.post("/api/github/webhook/app", { data: body, headers: { "content-type": "application/json", "x-github-event": "pull_request", "x-hub-signature-256": sig } });
      expect(await delivered.json()).toMatchObject({ ok: true, shipped: [OTHER_ORG_ISSUE_ID] });
      expect((await s.from("issues").select("status").eq("id", OTHER_ORG_ISSUE_ID).single()).data?.status).toBe("shipped");
      const { data: shipped } = await s.from("activity").select("user_id, payload").eq("issue_id", OTHER_ORG_ISSUE_ID).eq("kind", "shipped").single();
      expect(shipped).toMatchObject({ user_id: null, payload: { via: "github", pr_number: FAKE.github.pr } });
      // A bad signature changes nothing.
      expect((await request.post("/api/github/webhook/app", { data: body, headers: { "content-type": "application/json", "x-github-event": "pull_request", "x-hub-signature-256": "sha256=00" } })).status()).toBe(401);
    } finally {
      await s.from("builds").delete().eq("issue_id", OTHER_ORG_ISSUE_ID);
      await s.from("pull_request_links").delete().eq("issue_id", OTHER_ORG_ISSUE_ID);
      await s.from("activity").delete().eq("issue_id", OTHER_ORG_ISSUE_ID).in("kind", ["build_opened", "shipped", "reporters_told"]);
      if (solution) await s.from("solutions").delete().eq("id", solution.id);
      await s.from("issues").update({ status: issueBefore!.status }).eq("id", OTHER_ORG_ISSUE_ID);
    }
  });

  test("a plain member sees each tool's state, not its Connect buttons", async ({ browser }) => {
    const { OTHER_ORG, OTHER_APP } = fx();
    const ctx = await browser.newContext({ storageState: "e2e/.auth/two-orgs.json" });
    const page = await ctx.newPage();
    await page.goto(`/${OTHER_ORG}/${OTHER_APP}/settings`);
    const connections = page.locator("#connections");
    await expect(connections.getByRole("region", { name: "Granola" }).getByText("Connected", { exact: true })).toBeVisible();
    await expect(connections.getByRole("link", { name: "Connect to Slack" })).toHaveCount(0);
    await expect(connections.getByRole("button", { name: /Disconnect|Connect to/ })).toHaveCount(0);
    await ctx.close();
  });
});
