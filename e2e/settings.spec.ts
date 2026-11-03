// Settings saves for real against the dev database (no stubbed routes): the GitHub & Marver card's Save reaches
// projects through the owner's session, so it only works when it sends columns signed-in users may update (0018's
// column grants). Runs as the demo owner; the original values are put back afterwards.
import { existsSync, readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isProdUrl } from "../scripts/lib/guard";

const fx = (): { DEMO_APP_ID: string } => JSON.parse(readFileSync("e2e/.fixtures.json", "utf8"));

/** The service role, for reading back and restoring what the test changed. Dev only. */
function serviceClient(): SupabaseClient {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || isProdUrl(url)) throw new Error("e2e/settings.spec.ts runs on the dev Supabase project only.");
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}

test("the owner saves the design path and watched branch from GitHub & Marver, and they persist", async ({ page }) => {
  const { DEMO_APP_ID } = fx();
  const db = serviceClient();
  const { data: before, error } = await db.from("projects").select("repo_full_name, design_path, watched_branch").eq("id", DEMO_APP_ID).single();
  expect(error).toBeNull();
  const stamp = Date.now().toString(36);
  const next = { design_path: `e2e/design-${stamp}`, watched_branch: `e2e-branch-${stamp}` };
  try {
    await page.goto("/demo/celeste/settings");
    const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "GitHub & Marver" }) });
    // The demo app's repository is managed by PMA: no Repository card, and this card shows it read-only, as before.
    await expect(page.getByRole("heading", { name: "Repository", exact: true })).toHaveCount(0);
    await expect(card).toContainText("Connecting a repository moves to GitHub setup in a coming update.");
    if (before!.repo_full_name) await expect(card).toContainText(`Repository: ${before!.repo_full_name}.`);
    await expect(card.getByLabel("Repository")).toHaveCount(0);
    await expect(card.getByPlaceholder("owner/name")).toHaveCount(0);

    await card.getByLabel("Design path").fill(next.design_path);
    await card.getByLabel("Watched branch").fill(next.watched_branch);
    const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith(`/api/apps/${DEMO_APP_ID}/settings`));
    await card.getByRole("button", { name: "Save" }).click();
    const res = await saved;
    expect(res.status(), await res.text()).toBe(200);
    expect(res.request().postDataJSON()).toEqual(next);
    await expect(page.getByText("Saved")).toBeVisible();

    const { data: after } = await db.from("projects").select("repo_full_name, design_path, watched_branch").eq("id", DEMO_APP_ID).single();
    expect(after).toEqual({ ...next, repo_full_name: before!.repo_full_name });
    await page.reload();
    await expect(card.getByLabel("Design path")).toHaveValue(next.design_path);
    await expect(card.getByLabel("Watched branch")).toHaveValue(next.watched_branch);
  } finally {
    await db.from("projects").update({ design_path: before!.design_path, watched_branch: before!.watched_branch }).eq("id", DEMO_APP_ID);
  }
});

test("a save that names the repository is refused with a sentence and changes nothing", async ({ request }) => {
  const { DEMO_APP_ID } = fx();
  const db = serviceClient();
  const read = async () => (await db.from("projects").select("repo_full_name, design_path").eq("id", DEMO_APP_ID).single()).data;
  const before = await read();
  const res = await request.patch(`/api/apps/${DEMO_APP_ID}/settings`, { data: { repo_full_name: "someone/else", design_path: "e2e-refused" } });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toBe("The repository is connected through GitHub setup.");
  expect(await read()).toEqual(before);
});
