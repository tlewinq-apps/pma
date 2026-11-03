// Connecting a repository from Settings, for real: the dev database, and GitHub's public endpoints with no token
// (codeload's tarball and the unauthenticated repos API). Members get a 403 and outsiders a 404. The connect and
// disconnect run as the admin of e2e-other on its own app, whose repository is put back afterwards.
import { existsSync, readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isProdUrl } from "../scripts/lib/guard";

type Fixtures = { DEMO_APP_ID: string; OTHER_ORG: string; OTHER_APP: string; OTHER_ORG_APP_ID: string };
/** Read inside each test, not at import: global setup writes the file, and the spec may load before it has. */
const fx = (): Fixtures => JSON.parse(readFileSync("e2e/.fixtures.json", "utf8"));

/** The service role, for reading back and restoring what the test changed. Dev only. */
function serviceClient(): SupabaseClient {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || isProdUrl(url)) throw new Error("e2e/repo.spec.ts runs on the dev Supabase project only.");
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}

const repoCard = (page: Page) => page.locator("section").filter({ has: page.getByRole("heading", { name: "Repository", exact: true }) });

test.describe("a plain member", () => {
  test.use({ storageState: "e2e/.auth/member.json" });

  test("can't connect or disconnect (403)", async ({ request }) => {
    const { DEMO_APP_ID } = fx();
    for (const [method, data] of [["POST", { repo: "vercel/next.js" }], ["DELETE", undefined]] as const) {
      const res = await request.fetch(`/api/apps/${DEMO_APP_ID}/repo`, { method, data });
      expect(res.status(), method).toBe(403);
      expect((await res.json()).error).toBe("Only company owners and admins can change this.");
    }
  });
});

test.describe("a member of a customer company", () => {
  // e2e-two-orgs is a plain member of e2e-other.
  test.use({ storageState: "e2e/.auth/two-orgs.json" });

  test("sees the repository card without the buttons", async ({ page }) => {
    const { OTHER_ORG, OTHER_APP } = fx();
    await page.goto(`/${OTHER_ORG}/${OTHER_APP}/settings`);
    const card = repoCard(page);
    await expect(card).toBeVisible();
    await expect(card.getByRole("button", { name: "Connect" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Disconnect" })).toHaveCount(0);
    await expect(card.getByLabel("Repository")).toHaveCount(0);
  });
});

test("the demo app's owner can't repoint or disconnect its repository (409), and has no Repository card", async ({ request, page }) => {
  // The default state is the demo owner. The demo's repository decides where the deployment's token acts.
  const { DEMO_APP_ID } = fx();
  const db = serviceClient();
  const read = async () => (await db.from("projects").select("repo_full_name, watched_branch").eq("id", DEMO_APP_ID).single()).data;
  const before = await read();
  for (const [method, data] of [["POST", { repo: "vercel/next.js" }], ["DELETE", undefined]] as const) {
    const res = await request.fetch(`/api/apps/${DEMO_APP_ID}/repo`, { method, data });
    expect(res.status(), method).toBe(409);
    expect(await res.json()).toEqual({ error: "The demo app's repository is managed by PMA." });
  }
  expect(await read()).toEqual(before);
  await page.goto("/demo/celeste/settings");
  await expect(page.getByRole("heading", { name: "GitHub & Marver" })).toBeVisible();
  await expect(repoCard(page)).toHaveCount(0);
});

test("someone outside the company gets a 404 from connect and disconnect", async ({ request }) => {
  // The default state is the demo owner, who is not in e2e-other.
  const { OTHER_ORG_APP_ID } = fx();
  for (const [method, data] of [["POST", { repo: "vercel/next.js" }], ["DELETE", undefined]] as const) {
    expect((await request.fetch(`/api/apps/${OTHER_ORG_APP_ID}/repo`, { method, data })).status(), method).toBe(404);
  }
});

test.describe("the admin of e2e-other", () => {
  test.use({ storageState: "e2e/.auth/other-admin.json" });
  test.describe.configure({ mode: "serial" });

  /** Runs `fn` with e2e-other's app disconnected, and puts its repository and branch back afterwards. */
  async function onDisconnectedApp(fn: (db: SupabaseClient, appId: string) => Promise<void>) {
    const { OTHER_ORG_APP_ID } = fx();
    const db = serviceClient();
    const { data: before, error } = await db.from("projects").select("repo_full_name, watched_branch").eq("id", OTHER_ORG_APP_ID).single();
    expect(error).toBeNull();
    try {
      expect((await db.from("projects").update({ repo_full_name: null }).eq("id", OTHER_ORG_APP_ID)).error).toBeNull();
      await fn(db, OTHER_ORG_APP_ID);
    } finally {
      await db.from("projects").update(before!).eq("id", OTHER_ORG_APP_ID);
    }
  }

  test("connects vercel/next.js with no token, at its default branch, then disconnects", async ({ page }) => {
    const { OTHER_ORG, OTHER_APP } = fx();
    await onDisconnectedApp(async (db, appId) => {
      const read = async () => (await db.from("projects").select("repo_full_name, watched_branch").eq("id", appId).single()).data;
      await page.goto(`/${OTHER_ORG}/${OTHER_APP}/settings`);
      const card = repoCard(page);
      await card.getByLabel("Repository").fill("vercel/next.js");
      const connected = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/api/apps/${appId}/repo`), { timeout: 100_000 });
      await card.getByRole("button", { name: "Connect" }).click();
      const res = await connected;
      expect(res.status(), await res.text()).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, repo: "vercel/next.js", ref: "canary" });
      expect(body.files).toBeGreaterThan(100);
      await expect(card.getByText(/^Connected\. PMA can read [\d,]+ source files\.$/)).toBeVisible();
      await expect(card).toContainText("Connected to vercel/next.js on canary.");
      expect(await read()).toEqual({ repo_full_name: "vercel/next.js", watched_branch: "canary" });

      await page.reload();
      await expect(card).toContainText("Connected to vercel/next.js on canary.");
      const gone = page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().endsWith(`/api/apps/${appId}/repo`));
      await card.getByRole("button", { name: "Disconnect" }).click();
      expect((await gone).status()).toBe(200);
      await expect(card.getByText("Disconnected. PMA no longer reads that repository.")).toBeVisible();
      await expect(card.getByLabel("Repository")).toBeVisible();
      expect((await read())!.repo_full_name).toBeNull();
    });
  });

  test("a private or unknown repository gets the GitHub App sentence, and nothing is saved", async ({ page }) => {
    const { OTHER_ORG, OTHER_APP } = fx();
    await onDisconnectedApp(async (db, appId) => {
      await page.goto(`/${OTHER_ORG}/${OTHER_APP}/settings`);
      const card = repoCard(page);
      await card.getByLabel("Repository").fill("acme/definitely-not-a-repo-xyz");
      const answered = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/api/apps/${appId}/repo`));
      await card.getByRole("button", { name: "Connect" }).click();
      expect((await answered).status()).toBe(400);
      await expect(card.getByText("PMA can't read that repository. Private repositories connect through the PMA GitHub App, which comes in the next update.")).toBeVisible();
      await expect(card.getByLabel("Repository")).toBeVisible();
      expect((await db.from("projects").select("repo_full_name").eq("id", appId).single()).data).toEqual({ repo_full_name: null });
    });
  });
});
