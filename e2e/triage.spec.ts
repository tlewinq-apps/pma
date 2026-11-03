// Prereq: `npm run seed` on dev. e2e/global-setup.ts signs in the demo owner; the demo app is at /demo/celeste.
import { test, expect } from "@playwright/test";

const APP = "/demo/celeste";

test("seeded pickup bug sits on the Urgent or Bugs rail and opens its workspace", async ({ page }) => {
  await page.goto(APP);
  // Cards are links labelled "<Type>: <title>. <impact>. <stage>: <detail>." on one rail per type, under the Urgent rail
  // (which mixes types, so a pressing bug moves up there). Titles are LLM-generated, so match any pickup bug card on
  // either rail by its accessible name.
  const rails = page.getByRole("region", { name: /^(urgent|bugs)\b/i });
  const card = rails.getByRole("link", { name: /^Bug: .*pickup/i }).first();
  await expect(card).toBeVisible();
  await expect(card).toHaveAccessibleName(/diagnos|proposal|drafting|ready for review|in review|draft failed/i);
  await expect(card).not.toHaveAccessibleName(/priority/i);
  await card.click();
  await expect(page).toHaveURL(/\/demo\/celeste\/issues\//);
  for (const name of [/what's wrong/i, /diagnose first|proposal/i]) await expect(page.getByRole("heading", { name }).first()).toBeVisible();
  await expect(page.locator("blockquote").filter({ hasText: /spinner|spun/i }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/demo\/celeste\?(.*&)?focus=/);
});

test("a bug is diagnosed first, then its proposals can be mocked up", async ({ page }) => {
  test.skip(!process.env.E2E_DEMO_FLOW, "Changes data: run with E2E_DEMO_FLOW=1 against the snapshot seed in demo mode, then reseed");
  test.setTimeout(180_000);
  await page.goto(`${APP}?view=needs_diagnosis`);
  await page.getByRole("link", { name: /class messages fail to load/i }).click();
  await expect(page.getByRole("button", { name: /mock it up/i })).toHaveCount(0); // nothing to mock up before the diagnosis
  await page.getByRole("button", { name: /^run diagnostics/i }).click();
  await expect(page.getByText(/^cause found/i)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("button", { name: /^mock it up$/i })).toBeVisible({ timeout: 90_000 });
});

test("mocking up a proposal in demo mode goes from draft to shipped", async ({ page }) => {
  test.skip(!process.env.E2E_DEMO_FLOW, "Changes data: run with E2E_DEMO_FLOW=1 against the snapshot seed in demo mode, then reseed");
  test.setTimeout(120_000);
  await page.goto(`${APP}?view=ready_to_implement`);
  await page.getByRole("link", { name: /proposal ready/i }).first().click();
  await page.getByRole("button", { name: /^mock it up$/i }).click();
  const approve = page.getByRole("button", { name: /approve and ship/i });
  await expect(approve).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /request changes/i }).click();
  await page.getByLabel(/what should change/i).fill("Make the confirmation more prominent");
  await page.getByRole("button", { name: /send and re-draft/i }).click();
  await expect(page.getByText(/requested changes: make the confirmation/i)).toBeVisible({ timeout: 30_000 });
  await expect(approve).toBeVisible({ timeout: 30_000 });
  await approve.click();
  await expect(page.getByText(/^shipped$/i).first()).toBeVisible({ timeout: 15_000 });
});

test("pasting duplicate text reports it was skipped", async ({ page }) => {
  await page.goto(`${APP}/feedback`);
  const text = "Parent: The calendar export button does nothing when I tap it. " + Date.now();
  for (const expected of [/analysing now/i, /already existed/i]) {
    await page.getByPlaceholder(/paste a transcript/i).fill(text);
    await page.getByRole("button", { name: /add feedback/i }).click();
    await expect(page.getByText(expected)).toBeVisible();
  }
});

test("widget endpoint rejects unknown key", async ({ request }) => {
  const r = await request.post("/api/widget/feedback?key=nope", { data: { text: "hi" } });
  expect(r.status()).toBe(404);
});

test("a PM can edit a proposal, write their own, and mock it up", async ({ page }) => {
  test.skip(!process.env.E2E_DEMO_FLOW, "Changes data: run with E2E_DEMO_FLOW=1 against the snapshot seed in demo mode, then reseed");
  test.setTimeout(120_000);
  await page.goto(`${APP}?view=ready_to_implement`);
  await page.getByRole("link", { name: /proposal ready/i }).first().click();
  await page.getByRole("button", { name: /^edit /i }).first().click();
  const what = page.getByLabel(/edit proposal/i).locator("textarea").first();
  await what.press("End");
  await what.pressSequentially(" Keep it short.");
  await what.press("ControlOrMeta+Enter");
  await expect(page.getByText("Edited by you").first()).toBeVisible();
  await page.getByRole("button", { name: /^write a (fix|proposal)$/i }).click();
  await page.getByLabel(/how would you|what would you/i).fill("Show a receipt card after Send with the time and who is collecting.");
  await page.getByRole("button", { name: /^add$/i }).click();
  await page.getByRole("button", { name: /mock up your proposal/i }).click();
  await expect(page.getByRole("button", { name: /approve and ship/i })).toBeVisible({ timeout: 30_000 });
});
