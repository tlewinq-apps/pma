// Start here for a customer app (e2e-other's app, as its admin): the setup checklist, starting with Connect your
// repository, and the product description saved by hand (Read my repository calls Claude, so it isn't pressed here).
// The demo's Start here has the same steps, with its own Join Slack and no Connect cards. Also a customer app's Settings (no retired cards, the default alert
// size, the legacy Slack webhook card only while a webhook is saved) and people counted in the app's audience words on
// the Desk, in Why it matters and on the feedback page, against the demo's, which keep theirs. Whatever a test changes
// is put back.
import { existsSync, readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isProdUrl } from "../scripts/lib/guard";

type Fixtures = { DEMO_APP_ID: string; DEMO_ISSUE_ID: string; OTHER_ORG: string; OTHER_APP: string; OTHER_ORG_APP_ID: string; OTHER_ORG_ISSUE_ID: string };
const fx = (): Fixtures => JSON.parse(readFileSync("e2e/.fixtures.json", "utf8"));

function serviceClient(): SupabaseClient {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || isProdUrl(url)) throw new Error("e2e/onboarding.spec.ts runs on the dev Supabase project only.");
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}

test.describe("the admin of e2e-other", () => {
  test.use({ storageState: "e2e/.auth/other-admin.json" });
  test.describe.configure({ mode: "serial" });

  test("Start here is one step per screen: the basics, a screen per tool, then feedback, the team and the tour", async ({ page }) => {
    const { OTHER_ORG, OTHER_APP } = fx();
    const welcome = `/${OTHER_ORG}/${OTHER_APP}/welcome`;
    await page.goto(`${welcome}?step=intro`);
    await expect(page.getByRole("heading", { name: "Welcome to PMA" })).toBeVisible();
    const dots = page.getByRole("navigation", { name: "Setup steps" }).locator("ol").last().locator("a");
    expect(await dots.evaluateAll((as) => as.map((a) => new URL((a as HTMLAnchorElement).href).searchParams.get("step"))))
      .toEqual(["intro", "github", "claude", "product", "slack", "sentry", "posthog", "granola", "marver", "feedback", "team", "done"]);
    const step = page.locator("section[aria-labelledby='setup-step-title']");
    await page.goto(`${welcome}?step=claude`);
    await expect(step.getByRole("region", { name: "Claude" })).toBeVisible();
    await page.goto(`${welcome}?step=product`);
    await expect(page.getByRole("heading", { name: "Describe your product" })).toBeVisible();
    await page.goto(`${welcome}?step=feedback`);
    await expect(step.getByLabel("Widget snippet")).toHaveValue(/widget\.js" data-project=/);
    await expect(step.getByText("/api/v1/feedback", { exact: false })).toBeVisible();
    await expect(page.getByText(/what parents say/i)).toHaveCount(0);
  });

  test("describing the product by hand saves it, keeps the audience words drafted from the repository, and the Desk speaks of its people", async ({ page }) => {
    const { OTHER_ORG, OTHER_APP, OTHER_ORG_APP_ID } = fx();
    const db = serviceClient();
    const { data: before } = await db.from("projects").select("product_profile").eq("id", OTHER_ORG_APP_ID).single();
    try {
      // As Read my repository would have saved it: the audience words are drafted, then kept without being shown.
      await db.from("projects").update({ product_profile: { name: "Closet", one_liner: "a fashion app", audience: "shoppers", audience_one: "shopper", platform: "web" } }).eq("id", OTHER_ORG_APP_ID);
      await page.goto(`/${OTHER_ORG}/${OTHER_APP}/welcome?step=product`);
      const list = page.locator("section[aria-labelledby='setup-step-title']");
      await expect(list.getByLabel("Who uses it")).toHaveCount(0);
      await expect(list.getByLabel("One of them")).toHaveCount(0);
      await expect(list.getByText(/who uses it/i)).toHaveCount(0);
      await list.getByLabel("Name", { exact: true }).fill("Wardrobe");
      await list.getByLabel("In one line").fill("fashion app");
      await list.getByLabel("Used on").selectOption("web and mobile");
      await list.getByRole("button", { name: "Save" }).click();
      // The one-liner has to read mid-sentence ("feedback about an AI fashion app").
      await expect(list.getByText('Say what it is in one line that starts with "a" or "an"', { exact: false })).toBeVisible();
      await list.getByLabel("In one line").fill("an AI fashion app where people style outfits");
      await list.getByRole("button", { name: "Save" }).click();
      await expect(list.getByRole("status")).toHaveText("Saved.");
      const { data: after } = await db.from("projects").select("product_profile").eq("id", OTHER_ORG_APP_ID).single();
      expect(after?.product_profile).toEqual({ name: "Wardrobe", one_liner: "an AI fashion app where people style outfits", audience: "shoppers", audience_one: "shopper", platform: "web and mobile" });

      await page.goto(`/${OTHER_ORG}/${OTHER_APP}`);
      await expect(page.getByText("Feedback from shoppers sorted into bugs", { exact: false })).toBeVisible();
    } finally {
      await db.from("projects").update({ product_profile: before?.product_profile ?? null }).eq("id", OTHER_ORG_APP_ID);
    }
  });

  test("an app never described from its repository saves its people as people", async ({ page }) => {
    const { OTHER_ORG, OTHER_APP, OTHER_ORG_APP_ID } = fx();
    const db = serviceClient();
    const { data: before } = await db.from("projects").select("product_profile").eq("id", OTHER_ORG_APP_ID).single();
    try {
      await db.from("projects").update({ product_profile: null }).eq("id", OTHER_ORG_APP_ID);
      await page.goto(`/${OTHER_ORG}/${OTHER_APP}/welcome?step=product`);
      const list = page.locator("section[aria-labelledby='setup-step-title']");
      await list.getByLabel("Name", { exact: true }).fill("Wardrobe");
      await list.getByLabel("In one line").fill("an AI fashion app where people style outfits");
      await list.getByRole("button", { name: "Save" }).click();
      await expect(list.getByRole("status")).toHaveText("Saved.");
      const { data: after } = await db.from("projects").select("product_profile").eq("id", OTHER_ORG_APP_ID).single();
      expect(after?.product_profile).toEqual({ name: "Wardrobe", one_liner: "an AI fashion app where people style outfits", audience: "people", audience_one: "person", platform: "web" });
      await page.goto(`/${OTHER_ORG}/${OTHER_APP}`);
      await expect(page.getByText("Feedback from people sorted into bugs", { exact: false })).toBeVisible();
    } finally {
      await db.from("projects").update({ product_profile: before?.product_profile ?? null }).eq("id", OTHER_ORG_APP_ID);
    }
  });

  test("the Desk card counts people in the same audience words as the issue header", async ({ page }) => {
    const { OTHER_ORG, OTHER_APP, OTHER_ORG_APP_ID, OTHER_ORG_ISSUE_ID } = fx();
    const db = serviceClient();
    const { data: before } = await db.from("projects").select("product_profile").eq("id", OTHER_ORG_APP_ID).single();
    const { data: issue } = await db.from("issues").select("people_count").eq("id", OTHER_ORG_ISSUE_ID).single();
    const closet = { name: "Closet", one_liner: "an AI fashion app", audience: "shoppers", audience_one: "shopper", platform: "web" };
    // The card on the Desk and the header on the issue's own page, which must say the same thing.
    const says = async (words: string) => {
      await page.goto(`/${OTHER_ORG}/${OTHER_APP}`);
      const card = page.locator(`[data-card-id="${OTHER_ORG_ISSUE_ID}"]`);
      await expect(card).toContainText(words);
      await page.goto(`/${OTHER_ORG}/${OTHER_APP}/issues/${OTHER_ORG_ISSUE_ID}`);
      await expect(page.getByText(words, { exact: true })).toBeVisible();
    };
    try {
      await db.from("projects").update({ product_profile: closet }).eq("id", OTHER_ORG_APP_ID);
      await db.from("issues").update({ people_count: 1 }).eq("id", OTHER_ORG_ISSUE_ID);
      await says("1 shopper");
      await db.from("issues").update({ people_count: 3 }).eq("id", OTHER_ORG_ISSUE_ID);
      await says("3 shoppers");
      // An app that was never described has no audience words: people, as the header says.
      await db.from("projects").update({ product_profile: null }).eq("id", OTHER_ORG_APP_ID);
      await db.from("issues").update({ people_count: 1 }).eq("id", OTHER_ORG_ISSUE_ID);
      await says("1 person");
      await db.from("issues").update({ people_count: 2 }).eq("id", OTHER_ORG_ISSUE_ID);
      await says("2 people");
    } finally {
      await db.from("projects").update({ product_profile: before?.product_profile ?? null }).eq("id", OTHER_ORG_APP_ID);
      await db.from("issues").update({ people_count: issue?.people_count ?? 0 }).eq("id", OTHER_ORG_ISSUE_ID);
    }
  });

  test("Why it matters and the feedback page count people in the same audience words as the issue header", async ({ page }) => {
    const { OTHER_ORG, OTHER_APP, OTHER_ORG_APP_ID, OTHER_ORG_ISSUE_ID } = fx();
    const db = serviceClient();
    const { data: before } = await db.from("projects").select("product_profile").eq("id", OTHER_ORG_APP_ID).single();
    const { data: issue } = await db.from("issues").select("type, people_count, score_breakdown").eq("id", OTHER_ORG_ISSUE_ID).single();
    const closet = { name: "Closet", one_liner: "an AI fashion app", audience: "shoppers", audience_one: "shopper", platform: "web" };
    const at = new Date().toISOString();
    // A rated feature request raised by one person whose kind isn't known: urgency, stakeholders and the verdict all count them.
    const breakdown = {
      severity: 3, clarity: 3, scope: "single_screen", reach: 0.9, mappingConfidence: 0.8, peopleCount: 1,
      inputs: { severity: 3, reach: 0.9, peopleCount: 1, meanSentiment: -1, frustrated: false, lastReportAt: at, distinctPeople: 1, reportedByOthers: 0 },
    };
    let sourceId: string | null = null;
    try {
      await db.from("projects").update({ product_profile: closet }).eq("id", OTHER_ORG_APP_ID);
      await db.from("issues").update({ type: "new_feature", people_count: 1, score_breakdown: breakdown }).eq("id", OTHER_ORG_ISSUE_ID);
      const { data: source, error } = await db.from("sources").insert({
        project_id: OTHER_ORG_APP_ID, kind: "paste", author: "Sam", channel: "E2E", raw_text: "e2e: I want a bigger popup", content_hash: `e2e-people-words-${Date.now()}`, status: "done", occurred_at: at,
      }).select("id").single();
      expect(error).toBeNull();
      sourceId = source!.id as string;
      const { error: unitError } = await db.from("feedback_units").insert({
        source_id: sourceId, project_id: OTHER_ORG_APP_ID, issue_id: OTHER_ORG_ISSUE_ID, quote: "I want a bigger popup", type: "new_feature", sentiment: -1, emotion: "neutral", audience: null, speakers: ["Sam"],
      });
      expect(unitError).toBeNull();

      const panel = async (words: string, wrong: RegExp) => {
        await page.goto(`/${OTHER_ORG}/${OTHER_APP}/issues/${OTHER_ORG_ISSUE_ID}?why=1`);
        const why = page.getByRole("dialog", { name: "Why it matters" });
        await expect(why).toBeVisible();
        await expect(why).toContainText(`${words} asks for it`); // the verdict
        await expect(why).toContainText(`${words} in 30 days.`); // urgency
        await expect(why.locator("dt", { hasText: "People" }).locator("xpath=following-sibling::dd[1]")).toHaveText(words); // stakeholders
        await expect(why.locator("h3", { hasText: "Who raised it" }).locator("xpath=following-sibling::span")).toHaveText(words);
        await expect(why).not.toContainText(wrong);
      };
      const group = async (words: string, wrong: RegExp) => {
        await page.goto(`/${OTHER_ORG}/${OTHER_APP}/feedback/${sourceId}`);
        const issueGroup = page.getByRole("region").filter({ has: page.getByRole("link", { name: "Open the full analysis" }) });
        await expect(issueGroup).toContainText(`${words} asks for it`);
        await expect(issueGroup).not.toContainText(wrong);
      };
      await panel("1 shopper", /\b1 person\b/);
      await group("1 shopper", /\b1 person\b/);
      // An app that was never described has no audience words: person, as the header says.
      await db.from("projects").update({ product_profile: null }).eq("id", OTHER_ORG_APP_ID);
      await panel("1 person", /\bshoppers?\b/);
      await group("1 person", /\bshoppers?\b/);
    } finally {
      if (sourceId) {
        await db.from("feedback_units").delete().eq("source_id", sourceId);
        await db.from("sources").delete().eq("id", sourceId);
      }
      await db.from("issues").update({ type: issue?.type ?? "bug", people_count: issue?.people_count ?? 0, score_breakdown: issue?.score_breakdown ?? null }).eq("id", OTHER_ORG_ISSUE_ID);
      await db.from("projects").update({ product_profile: before?.product_profile ?? null }).eq("id", OTHER_ORG_APP_ID);
    }
  });
});

test("a plain member of e2e-other sees the description read-only", async ({ browser }) => {
  const { OTHER_ORG, OTHER_APP } = fx();
  const ctx = await browser.newContext({ storageState: "e2e/.auth/two-orgs.json" });
  const page = await ctx.newPage();
  await page.goto(`/${OTHER_ORG}/${OTHER_APP}/welcome?step=product`);
  const list = page.locator("section[aria-labelledby='setup-step-title']");
  await expect(list.getByRole("button", { name: "Save" })).toHaveCount(0);
  await expect(list.getByRole("button", { name: "Read my repository" })).toHaveCount(0);
  await ctx.close();
});

test("the demo's Start here walks the welcome, how feedback is sorted, Join Slack and the tour, with no Connect cards", async ({ page }) => {
  await page.goto("/demo/celeste/welcome");
  await expect(page.getByRole("heading", { name: "Welcome to PMA" })).toBeVisible();
  await expect(page.getByText("PMA turns what Celeste's members say into shipped fixes.", { exact: false })).toBeVisible();
  const dots = page.getByRole("navigation", { name: "Setup steps" }).locator("ol").last().locator("a");
  expect(await dots.evaluateAll((as) => as.map((a) => new URL((a as HTMLAnchorElement).href).searchParams.get("step")))).toEqual(["intro", "feedback", "slack", "done"]);
  await page.goto("/demo/celeste/welcome?step=slack");
  await expect(page.getByRole("heading", { name: "Join the Slack workspace" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Claude" })).toHaveCount(0);
  await page.goto("/demo/celeste");
  await expect(page.getByText("Member feedback sorted into bugs", { exact: false })).toBeVisible();
});

test("the demo's Desk cards keep saying person and people, not parents", async ({ page }) => {
  const { DEMO_ISSUE_ID } = fx();
  await page.goto("/demo/celeste");
  const card = page.locator(`[data-card-id="${DEMO_ISSUE_ID}"]`);
  await expect(card).toBeVisible();
  await expect(card).toContainText(/\d+ (person|people)/);
  await expect(card).not.toContainText(/\d+ parents?\b/);
});

test("the demo's Why it matters keeps saying person and people, not parents", async ({ page }) => {
  const { DEMO_ISSUE_ID } = fx();
  await page.goto(`/demo/celeste/issues/${DEMO_ISSUE_ID}?why=1`);
  const why = page.getByRole("dialog", { name: "Why it matters" });
  await expect(why).toBeVisible();
  await expect(why.locator("h3", { hasText: "Who raised it" }).locator("xpath=following-sibling::span")).toHaveText(/^\d+ (person|people)$/);
  await expect(why).not.toContainText(/\d+ parents? (in 30 days|ask)/);
});

test.describe("Settings", () => {
  test("a customer app shows its Connections, not the demo's developer health card", async ({ browser }) => {
    const { OTHER_ORG, OTHER_APP } = fx();
    const ctx = await browser.newContext({ storageState: "e2e/.auth/other-admin.json" });
    const page = await ctx.newPage();
    await page.goto(`/${OTHER_ORG}/${OTHER_APP}/settings`);
    const card = page.getByRole("region", { name: "Connections" });
    await expect(card).toBeVisible();
    for (const tool of ["Claude", "Slack", "Marver", "PostHog", "Granola"]) await expect(card.getByRole("region", { name: tool })).toBeVisible();
    for (const row of ["Repository", "In-app widget"]) await expect(card.getByText(row, { exact: true })).toBeVisible();
    await expect(card.getByText("Coming next", { exact: false })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Demo health" })).toHaveCount(0);
    await expect(page.getByText(/built-in sample canvas|mock runner/i)).toHaveCount(0);
    await ctx.close();
  });

  test("a customer app has no GitHub & Marver card, retired workflow steps or legacy Slack webhook card", async ({ browser }) => {
    const { OTHER_ORG, OTHER_APP } = fx();
    const ctx = await browser.newContext({ storageState: "e2e/.auth/other-admin.json" });
    const page = await ctx.newPage();
    await page.goto(`/${OTHER_ORG}/${OTHER_APP}/settings`);
    // What it does have: the Repository card, one Connections card per tool, and the rest.
    for (const name of ["Repository", "Connections", "Alerts", "Where feedback comes from", "Widget", "API"]) await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    for (const name of ["GitHub & Marver", "Slack webhook (legacy)"]) await expect(page.getByRole("heading", { name })).toHaveCount(0);
    await expect(page.getByLabel("Design path")).toHaveCount(0);
    await expect(page.getByLabel("Watched branch")).toHaveCount(0);
    await expect(page.getByPlaceholder("https://hooks.slack.com/services/…")).toHaveCount(0);
    await expect(page.getByText(/github-template|pma-draft|draft workflow|\.github\/workflows|ANTHROPIC_API_KEY|Slack app above/i)).toHaveCount(0);
    // Slack lives under Connections, and the Alerts card says so.
    await expect(page.getByText("Connect Slack under Connections to send them", { exact: false })).toBeVisible();
    await ctx.close();
  });

  test("a customer app that still has a saved Slack webhook sees that card, so it can be cleared", async ({ browser }) => {
    const { OTHER_ORG, OTHER_APP, OTHER_ORG_APP_ID } = fx();
    const db = serviceClient();
    const { data: before } = await db.from("projects").select("slack_webhook_url").eq("id", OTHER_ORG_APP_ID).single();
    const hook = "https://hooks.slack.com/services/T0E2E/B0E2E/e2e";
    const ctx = await browser.newContext({ storageState: "e2e/.auth/other-admin.json" });
    const page = await ctx.newPage();
    try {
      await db.from("projects").update({ slack_webhook_url: hook }).eq("id", OTHER_ORG_APP_ID);
      await page.goto(`/${OTHER_ORG}/${OTHER_APP}/settings`);
      const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Slack webhook (legacy)" }) });
      await expect(card).toBeVisible();
      await expect(card.getByPlaceholder("https://hooks.slack.com/services/…")).toHaveValue(hook);
      await expect(card).toContainText("Clear the address and save to remove it; Slack under Connections replaces it.");
      await expect(card).not.toContainText("Slack app above");
      // Still none of the retired GitHub & Marver card.
      await expect(page.getByRole("heading", { name: "GitHub & Marver" })).toHaveCount(0);
      // Clearing it saves nothing, and the card goes with it.
      await card.getByPlaceholder("https://hooks.slack.com/services/…").fill("");
      await card.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
      expect((await db.from("projects").select("slack_webhook_url").eq("id", OTHER_ORG_APP_ID).single()).data!.slack_webhook_url).toBeNull();
      await page.reload();
      await expect(page.getByRole("heading", { name: "Alerts", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Slack webhook (legacy)" })).toHaveCount(0);
    } finally {
      await db.from("projects").update({ slack_webhook_url: before?.slack_webhook_url ?? null }).eq("id", OTHER_ORG_APP_ID);
      await ctx.close();
    }
  });

  test("a customer app that saved no alert rules shows the default jump size", async ({ browser }) => {
    const { OTHER_ORG, OTHER_APP, OTHER_ORG_APP_ID } = fx();
    const db = serviceClient();
    const { data: before } = await db.from("projects").select("alert_rules").eq("id", OTHER_ORG_APP_ID).single();
    const ctx = await browser.newContext({ storageState: "e2e/.auth/other-admin.json" });
    const page = await ctx.newPage();
    try {
      await db.from("projects").update({ alert_rules: {} }).eq("id", OTHER_ORG_APP_ID);
      await page.goto(`/${OTHER_ORG}/${OTHER_APP}/settings`);
      const jump = page.getByRole("checkbox", { name: /A sudden jump/ });
      await expect(jump).toBeChecked();
      await expect(page.getByRole("spinbutton", { name: "Points" })).toHaveValue("15");
      // A saved size is kept.
      await db.from("projects").update({ alert_rules: { jump: { enabled: true, points: 22 } } }).eq("id", OTHER_ORG_APP_ID);
      await page.reload();
      await expect(page.getByRole("spinbutton", { name: "Points" })).toHaveValue("22");
    } finally {
      await db.from("projects").update({ alert_rules: before?.alert_rules ?? {} }).eq("id", OTHER_ORG_APP_ID);
      await ctx.close();
    }
  });

  test("the demo keeps its GitHub & Marver card, its legacy Slack webhook card and its saved jump size", async ({ page }) => {
    const { DEMO_APP_ID } = fx();
    const { data } = await serviceClient().from("projects").select("alert_rules").eq("id", DEMO_APP_ID).single();
    await page.goto("/demo/celeste/settings");
    await expect(page.getByRole("heading", { name: "GitHub & Marver" })).toBeVisible();
    await expect(page.getByText("Install the draft workflow:", { exact: false })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Slack webhook (legacy)" })).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: "Points" })).toHaveValue(String(data?.alert_rules?.jump?.points ?? 15));
  });

  test("the demo keeps its Demo health card", async ({ page }) => {
    await page.goto("/demo/celeste/settings");
    await expect(page.getByRole("heading", { name: "Demo health" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Connections" })).toHaveCount(0);
  });
});
