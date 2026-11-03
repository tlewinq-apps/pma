// Tenancy: every page lives under /[org]/[app], outsiders get a 404, and the old top-level links redirect into the
// company that owns them. Runs as the demo owner (the default storage state) unless a describe picks another
// person; fixtures come from e2e/global-setup.ts.
import { existsSync, readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isProdUrl } from "../scripts/lib/guard";

type Fixtures = {
  DEMO_APP_ID: string; DEMO_ISSUE_ID: string; DEMO_SOURCE_ID?: string; DEMO_DRAFT_ID?: string;
  OTHER_ORG: string; OTHER_APP: string; OTHER_ORG_APP_ID: string; OTHER_ORG_ISSUE_ID: string;
};
/** Read inside each test, not at import: global setup writes the file, and the spec may load before it has. */
const fx = (): Fixtures => JSON.parse(readFileSync("e2e/.fixtures.json", "utf8"));

test("the Desk lives at /demo/celeste and its links stay inside the app", async ({ page }) => {
  await page.goto("/demo/celeste");
  await expect(page.getByRole("navigation").getByRole("link", { name: "Work" })).toHaveAttribute("href", "/demo/celeste/work");
  const card = page.getByRole("region", { name: /bugs/i }).getByRole("link").first();
  await card.click();
  await expect(page).toHaveURL(/\/demo\/celeste\/issues\//);
});

test("an unknown company or app is a 404", async ({ page }) => {
  expect((await page.goto("/demo/not-an-app"))!.status()).toBe(404);
  expect((await page.goto("/someone-else/app"))!.status()).toBe(404);
});

test("an issue in another company is a 404 under our own app, not a redirect into theirs", async ({ page }) => {
  const { OTHER_ORG_ISSUE_ID } = fx();
  expect((await page.goto(`/demo/celeste/issues/${OTHER_ORG_ISSUE_ID}`))!.status()).toBe(404);
  // The old short link finds nothing either: the issue is invisible to us, so there is no company to send us to.
  expect((await page.goto(`/issues/${OTHER_ORG_ISSUE_ID}`))!.status()).toBe(404);
  expect(new URL(page.url()).pathname).toBe(`/issues/${OTHER_ORG_ISSUE_ID}`);
});

test.describe("old links redirect into the right company", () => {
  test("an old /issues link redirects into the issue's company and keeps its query", async ({ page }) => {
    const { DEMO_ISSUE_ID } = fx();
    await page.goto(`/issues/${DEMO_ISSUE_ID}?why=1`);
    await expect(page).toHaveURL(new RegExp(`/demo/celeste/issues/${DEMO_ISSUE_ID}\\?why=1$`));
  });

  test("an old /feedback/<id> link redirects into the source's company and keeps its query", async ({ page }) => {
    const { DEMO_SOURCE_ID } = fx();
    test.skip(!DEMO_SOURCE_ID, "The dev seed has no feedback source for demo/celeste; run `npm run seed`.");
    await page.goto(`/feedback/${DEMO_SOURCE_ID}?unit=1`);
    await expect(page).toHaveURL(new RegExp(`/demo/celeste/feedback/${DEMO_SOURCE_ID}\\?unit=1$`));
  });

  test("an old mock pull request link redirects into the draft's company and keeps its query", async ({ page }) => {
    const { DEMO_DRAFT_ID } = fx();
    test.skip(!DEMO_DRAFT_ID, "The dev seed has no draft on a demo/celeste issue, so there is no /mock/pr/<id> link to follow.");
    await page.goto(`/mock/pr/${DEMO_DRAFT_ID}?x=1`);
    await expect(page).toHaveURL(new RegExp(`/demo/celeste/mock/pr/${DEMO_DRAFT_ID}\\?x=1$`));
  });

  test("a made-up id on an old link is a 404", async ({ page }) => {
    const nobody = "00000000-0000-4000-8000-000000000000";
    expect((await page.goto(`/issues/${nobody}`))!.status()).toBe(404);
    expect((await page.goto(`/feedback/${nobody}`))!.status()).toBe(404);
    expect((await page.goto(`/mock/pr/${nobody}`))!.status()).toBe(404);
    expect((await page.goto("/issues/not-a-uuid"))!.status()).toBe(404);
  });

  test("the old root and section pages go to the app the person last used, keeping the query", async ({ page }) => {
    const { DEMO_ISSUE_ID } = fx();
    await page.goto("/");
    await expect(page).toHaveURL(/\/demo\/celeste$/);
    await page.goto("/?view=bugs");
    await expect(page).toHaveURL(/\/demo\/celeste\?view=bugs$/);
    await page.goto(`/?issue=${DEMO_ISSUE_ID}&from=bugs`);
    await expect(page).toHaveURL(new RegExp(`/demo/celeste/issues/${DEMO_ISSUE_ID}\\?from=bugs$`));
    for (const [old, now] of [["/work", "/work"], ["/projects", "/work"], ["/flows", "/flows"], ["/feedback", "/feedback"], ["/settings", "/settings"], ["/welcome?tour=1", "/welcome?tour=1"], ["/projects?view=x", "/work?view=x"]]) {
      await page.goto(old);
      await expect(page).toHaveURL(new RegExp(`/demo/celeste${now.replace("?", "\\?")}$`));
    }
  });

  test("/<company> opens the company's first app, and a company we are not in is a 404", async ({ page }) => {
    await page.goto("/demo?x=1");
    await expect(page).toHaveURL(/\/demo\/celeste\?x=1$/);
    expect((await page.goto(`/${fx().OTHER_ORG}`))!.status()).toBe(404);
    expect((await page.goto("/no-such-company"))!.status()).toBe(404);
  });
});

test.describe("someone in two companies", () => {
  test.use({ storageState: "e2e/.auth/two-orgs.json" });

  test("lands in the company that owns the link", async ({ page }) => {
    const { OTHER_ORG, OTHER_APP, OTHER_ORG_ISSUE_ID, DEMO_ISSUE_ID } = fx();
    await page.goto(`/issues/${OTHER_ORG_ISSUE_ID}`);
    await expect(page).toHaveURL(new RegExp(`/${OTHER_ORG}/${OTHER_APP}/issues/${OTHER_ORG_ISSUE_ID}$`));
    await page.goto(`/issues/${DEMO_ISSUE_ID}`);
    await expect(page).toHaveURL(new RegExp(`/demo/celeste/issues/${DEMO_ISSUE_ID}$`));
  });
});

test.describe("someone in no company", () => {
  test.use({ storageState: "e2e/.auth/no-org.json" });

  test("sees the no-company page, not a loop", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/no-company$/);
    await expect(page.getByText(/not in a company on PMA yet/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
  });

  test("every old section link ends at the no-company page", async ({ page }) => {
    for (const old of ["/work", "/projects", "/flows", "/feedback", "/settings", "/welcome?tour=1"]) {
      await page.goto(old);
      await expect(page).toHaveURL(/\/no-company$/);
    }
  });

  test("an old issue link is a 404, not a company", async ({ page }) => {
    expect((await page.goto(`/issues/${fx().DEMO_ISSUE_ID}`))!.status()).toBe(404);
  });

  test("can sign out from the page", async ({ context, page }) => {
    // Answer the logout call here instead of letting it reach Supabase: it would end this person's real session, which
    // every other test in this describe shares. The browser client still clears its own cookies.
    let loggedOut = false;
    await page.route("**/auth/v1/logout*", (route) => { loggedOut = true; return route.fulfill({ status: 204 }); });
    await page.goto("/no-company");
    await page.getByRole("button", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    expect(loggedOut).toBe(true);
    expect((await context.cookies()).filter((c) => c.name.startsWith("sb-") && c.value)).toHaveLength(0);
  });

  test("a company's app is a 404", async ({ page }) => {
    expect((await page.goto("/demo/celeste"))!.status()).toBe(404);
  });
});

test.describe("a platform admin who is in no company", () => {
  test.use({ storageState: "e2e/.auth/platform.json" });

  test("gets a 404 at a company's app", async ({ page }) => {
    expect((await page.goto("/demo/celeste"))!.status()).toBe(404);
  });
});

// API routes: app-level ones live under /api/apps/[appId], issue and source routes find their app from the row. A person
// outside the company always gets a 404 (never a 403), so the answer does not reveal that the company or issue exists.
const MADE_UP = "00000000-0000-4000-8000-000000000000";

test.describe("API routes are scoped to an app", () => {
  test("refuse apps and issues from another company", async ({ request }) => {
    const { OTHER_ORG_APP_ID, OTHER_ORG_ISSUE_ID } = fx();
    expect((await request.patch(`/api/apps/${OTHER_ORG_APP_ID}/settings`, { data: { name: "x" } })).status()).toBe(404);
    expect((await request.post(`/api/issues/${OTHER_ORG_ISSUE_ID}/approve`)).status()).toBe(404);
  });

  test("every app-level route is a 404 for an app in another company, a made-up id or a non-UUID", async ({ request }) => {
    const { OTHER_ORG_APP_ID } = fx();
    const routes: [string, string][] = [
      ["POST", "/sources"], ["PATCH", "/settings"], ["POST", "/github/sync"], ["GET", "/slack/setup"], ["POST", "/slack/setup"],
      ["POST", "/slack/test"], ["POST", "/alerts/digest"], ["GET", "/tour/slack"],
      ["POST", "/feedback/recordings"], ["POST", "/feedback/recordings/upload-url"], ["POST", "/repo"], ["DELETE", "/repo"],
    ];
    for (const appId of [OTHER_ORG_APP_ID, MADE_UP, "not-a-uuid"]) {
      for (const [method, path] of routes) {
        const res = await request.fetch(`/api/apps/${appId}${path}`, { method, data: method === "GET" ? undefined : {} });
        expect(res.status(), `${method} /api/apps/${appId}${path}`).toBe(404);
      }
    }
  });

  test("every issue route is a 404 for an issue in another company, a made-up id or a non-UUID", async ({ request }) => {
    const { OTHER_ORG_ISSUE_ID } = fx();
    const routes: [string, string][] = [
      ["GET", ""], ["PATCH", ""], ["POST", "/approve"], ["POST", "/comments"], ["POST", "/diagnose"], ["POST", "/draft"],
      ["POST", "/flow"], ["POST", "/followups"], ["POST", "/propose"], ["POST", "/request-changes"], ["POST", "/solve"],
      ["POST", "/solutions"], ["PATCH", `/solutions/${MADE_UP}`], ["DELETE", `/solutions/${MADE_UP}`], ["POST", "/view"],
    ];
    for (const id of [OTHER_ORG_ISSUE_ID, MADE_UP, "not-a-uuid"]) {
      for (const [method, path] of routes) {
        const res = await request.fetch(`/api/issues/${id}${path}`, { method, data: method === "GET" ? undefined : {} });
        expect(res.status(), `${method} /api/issues/${id}${path}`).toBe(404);
      }
    }
  });

  test("a source in another company cannot be retried, and a made-up one is a 404", async ({ request }) => {
    for (const id of [MADE_UP, "not-a-uuid"]) expect((await request.post(`/api/sources/${id}/retry`)).status(), id).toBe(404);
  });

  test("the owner reaches the routes under their own app (the 400 is the route's own validation, not a 404)", async ({ request }) => {
    const { DEMO_APP_ID, DEMO_ISSUE_ID } = fx();
    const settings = await request.patch(`/api/apps/${DEMO_APP_ID}/settings`, { data: { name: "x" } });
    expect(settings.status()).toBe(400);
    expect((await settings.json()).error).toMatch(/no valid fields/i);
    expect((await request.get(`/api/issues/${DEMO_ISSUE_ID}`)).status()).toBe(200);
    expect((await request.post(`/api/issues/${DEMO_ISSUE_ID}/view`)).status()).toBe(200);
  });

  test("the old unscoped routes are gone", async ({ request }) => {
    for (const [method, path] of [["POST", "/api/sources"], ["PATCH", "/api/settings"], ["POST", "/api/github/sync"], ["POST", "/api/slack/setup"], ["POST", "/api/slack/test"], ["POST", "/api/alerts/digest"], ["GET", "/api/tour/slack"], ["POST", "/api/feedback/recordings"], ["POST", "/api/feedback/recordings/upload-url"]]) {
      expect((await request.fetch(path, { method, data: method === "GET" ? undefined : {} })).status(), `${method} ${path}`).toBe(404);
    }
  });

  test.describe("signed out", () => {
    test.use({ storageState: { cookies: [], origins: [] } });
    test("an app route and an issue route answer 401", async ({ request }) => {
      const { DEMO_APP_ID, DEMO_ISSUE_ID } = fx();
      expect((await request.patch(`/api/apps/${DEMO_APP_ID}/settings`, { data: { name: "x" } })).status()).toBe(401);
      expect((await request.post(`/api/issues/${DEMO_ISSUE_ID}/approve`)).status()).toBe(401);
    });
  });
});

test.describe("a plain member", () => {
  test.use({ storageState: "e2e/.auth/member.json" });

  test("cannot change settings or set up Slack (403), but still reads their company's issues", async ({ request }) => {
    const { DEMO_APP_ID, DEMO_ISSUE_ID } = fx();
    const denied = await request.patch(`/api/apps/${DEMO_APP_ID}/settings`, { data: { name: "x" } });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).error).toBe("Only company owners and admins can change this.");
    for (const [method, path] of [["GET", "/slack/setup"], ["POST", "/slack/setup"], ["POST", "/slack/test"]]) {
      expect((await request.fetch(`/api/apps/${DEMO_APP_ID}${path}`, { method, data: method === "GET" ? undefined : {} })).status(), `${method} ${path}`).toBe(403);
    }
    expect((await request.get(`/api/issues/${DEMO_ISSUE_ID}`)).status()).toBe(200);
  });

  test("get a 404, not a 403, for another company's app", async ({ request }) => {
    expect((await request.patch(`/api/apps/${fx().OTHER_ORG_APP_ID}/settings`, { data: { name: "x" } })).status()).toBe(404);
  });

  for (const [width, label] of [[1280, "the full sidebar"], [375, "the narrow sidebar, as an icon"]] as const) {
    test(`can sign out from ${label} on any page`, async ({ context, page }) => {
      // As in "can sign out from the page": the logout call is answered here, so the session every test shares lives on.
      let loggedOut = false;
      await page.route("**/auth/v1/logout*", (route) => { loggedOut = true; return route.fulfill({ status: 204 }); });
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/demo/celeste/settings");
      // next dev's own badge (bottom left, dev only) sits over the narrow sidebar's last icon; production has none.
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      await page.getByRole("complementary").getByRole("button", { name: "Sign out" }).click();
      await expect(page).toHaveURL(/\/sign-in/);
      expect(loggedOut).toBe(true);
      expect((await context.cookies()).filter((c) => c.name.startsWith("sb-") && c.value)).toHaveLength(0);
    });
  }
});

/** The service role, for setting up and checking what a route must not touch. Dev only. */
function serviceClient(): SupabaseClient {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || isProdUrl(url)) throw new Error("This test runs on the dev Supabase project only.");
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Slack is per company: an app's channels live in its own company's workspace (Add to Slack). Until a company connects
// Slack, setting up channels is refused before any Slack call or write, and another company's app stays a 404.
test.describe("an admin of another company", () => {
  test.use({ storageState: "e2e/.auth/other-admin.json" });

  test("can't set up Slack channels before their company connects Slack: 400 before any Slack call, nothing written", async ({ request }) => {
    const { DEMO_APP_ID, OTHER_ORG_APP_ID } = fx();
    const db = serviceClient();
    const snapshot = async () => ({
      channels: (await db.from("slack_channels").select("project_id, role, channel_id").order("channel_id")).data,
      posts: (await db.from("slack_posts").select("project_id, ref, channel_id, ts").order("ref")).data,
    });
    const before = await snapshot();
    for (const data of [{}, { prefix: "e2e-other" }, { inbox: "CE2EFAKE0001", cards: "CE2EFAKE0002" }]) {
      const res = await request.post(`/api/apps/${OTHER_ORG_APP_ID}/slack/setup`, { data });
      expect(res.status(), JSON.stringify(data)).toBe(400);
      expect((await res.json()).error).toBe("Connect to Slack first.");
    }
    expect(await snapshot()).toEqual(before);
    // The demo's own app is not theirs to touch: a 404, as for any outsider.
    expect((await request.post(`/api/apps/${DEMO_APP_ID}/slack/setup`, { data: {} })).status()).toBe(404);
  });
});

/**
 * Runs `fn` while the demo app holds Slack on dev (dev usually has no channel rows, so a fake inbox row is added and
 * removed after). Tests in this file run one at a time, so the row is never added or removed under another test here.
 */
async function whileDemoHoldsSlack(fn: () => Promise<void>) {
  const { DEMO_APP_ID } = fx();
  const db = serviceClient();
  const FAKE_CHANNEL = "CE2EFAKE0002";
  const { data: rows } = await db.from("slack_channels").select("role").eq("project_id", DEMO_APP_ID);
  const added = !rows?.length;
  if (added) expect((await db.from("slack_channels").insert({ project_id: DEMO_APP_ID, role: "inbox", channel_id: FAKE_CHANNEL })).error).toBeNull();
  try {
    await fn();
  } finally {
    if (added) await db.from("slack_channels").delete().eq("project_id", DEMO_APP_ID).eq("channel_id", FAKE_CHANNEL);
  }
}

// SLACK_INVITE_URL is the deployment's own workspace (the site owner's, on production). Only an app on that workspace offers it;
// every other company's pages never mention it or #pma-feedback, and offer Connect to Slack for their own.
test.describe("Slack is per company", () => {
  test.describe("another company's admin", () => {
    test.use({ storageState: "e2e/.auth/other-admin.json" });

    test("sees no Join Slack link, no demo Slack steps on Start here, and their own Slack card in Settings", async ({ page }) => {
      const { OTHER_ORG, OTHER_APP } = fx();
      await whileDemoHoldsSlack(async () => {
        await page.goto(`/${OTHER_ORG}/${OTHER_APP}/welcome?step=intro`);
        await expect(page.getByRole("heading", { name: "Welcome to PMA" })).toBeVisible();
        await expect(page.getByRole("link", { name: /join slack/i })).toHaveCount(0);
        await expect(page.getByRole("heading", { name: /join the slack workspace/i })).toHaveCount(0);
        await expect(page.getByText(/pma-feedback/i)).toHaveCount(0);
        await page.goto(`/${OTHER_ORG}/${OTHER_APP}/welcome?step=feedback`);
        await expect(page.getByText(/in-app widget/i)).toBeVisible();
        await page.goto(`/${OTHER_ORG}/${OTHER_APP}/settings`);
        const slack = page.getByRole("region", { name: "Slack" });
        await expect(slack.getByText("Not connected")).toBeVisible();
        await expect(slack.getByText(/Connect to Slack|isn't set up on this deployment/).first()).toBeVisible();
        await expect(page.getByText(/connected to .* as @/i)).toHaveCount(0);
        await expect(page.getByRole("button", { name: /create channels/i })).toHaveCount(0);
      });
    });

    test("the tour's Join Slack check never looks them up in another app's workspace", async ({ request }) => {
      const { OTHER_ORG_APP_ID } = fx();
      await whileDemoHoldsSlack(async () => {
        const res = await request.get(`/api/apps/${OTHER_ORG_APP_ID}/tour/slack`);
        expect(res.status()).toBe(200);
        expect(await res.json()).toEqual({ joined: false });
      });
    });
  });

  test("control: the demo owner gets the Slack steps on Start here while the demo holds Slack", async ({ page }) => {
    // The demo's Slack is the deployment's own workspace, so this needs a dev server with SLACK_BOT_TOKEN set.
    test.skip(!process.env.E2E_SLACK_LEGACY, "Needs a dev server with SLACK_BOT_TOKEN (the demo's workspace): run with E2E_SLACK_LEGACY=1");
    await whileDemoHoldsSlack(async () => {
      await page.goto("/demo/celeste/welcome");
      await expect(page.getByRole("heading", { name: /join the slack workspace/i })).toBeVisible();
      await expect(page.getByText(/pma-feedback/i).first()).toBeVisible();
    });
  });
});

test.describe("adding feedback posts to the app's own route", () => {
  test("the Paste text form posts to /api/apps/<this app>/sources", async ({ page }) => {
    const { DEMO_APP_ID } = fx();
    // Answered here so the check adds nothing to the dev database; the real round trip is the test below.
    let posted: string | null = null;
    await page.route("**/api/**/sources", (route) => {
      posted = new URL(route.request().url()).pathname;
      return route.fulfill({ json: { sources: [{ id: MADE_UP, duplicate: false }], errors: [] } });
    });
    await page.goto("/demo/celeste/feedback");
    await page.getByPlaceholder(/paste a transcript/i).fill("Stubbed note: the route check only");
    await page.getByRole("button", { name: "Add feedback" }).click();
    await expect(page.getByText(/analysing now/i)).toBeVisible();
    expect(posted).toBe(`/api/apps/${DEMO_APP_ID}/sources`);
  });

  test("a pasted note reaches the Received list", async ({ page }) => {
    test.skip(!process.env.E2E_ADD_FEEDBACK, "Adds a source to the dev demo app and starts the pipeline on it: run with E2E_ADD_FEEDBACK=1");
    const stamp = Date.now();
    await page.goto("/demo/celeste/feedback");
    await page.getByPlaceholder(/paste a transcript/i).fill(`E2E paste ${stamp}: the export button does nothing on the class page.`);
    await page.getByRole("button", { name: "Add feedback" }).click();
    await expect(page.getByText(/analysing now/i)).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(`E2E paste ${stamp}`) })).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("the browser calls the app's own routes", () => {
  /** Answers every /api/apps call with an empty success and lists "METHOD /path" for each, so nothing reaches the database, Slack or GitHub. */
  async function stubAppApi(page: import("@playwright/test").Page) {
    const calls: string[] = [];
    await page.route("**/api/apps/**", (route) => {
      const req = route.request();
      calls.push(`${req.method()} ${new URL(req.url()).pathname}`);
      return route.fulfill({ json: { ok: true, count: 1, flows: 0, source: "stub", path: "stub/path.mp3", url: "http://localhost:3000/stub-upload", sources: [{ id: MADE_UP, duplicate: false }] } });
    });
    await page.route("**/stub-upload", (route) => route.fulfill({ status: 200, body: "" }));
    return calls;
  }

  test("Settings: save, sync and test go to /api/apps/<this app>", async ({ page }) => {
    const { DEMO_APP_ID } = fx();
    const calls = await stubAppApi(page);
    await page.goto("/demo/celeste/settings");
    await page.getByRole("button", { name: "Save alerts" }).click();
    await expect(page.getByText("Saved")).toBeVisible();
    await page.getByRole("button", { name: "Sync screens now" }).click();
    await expect(page.getByText(/Synced 1 screens/)).toBeVisible();
    await page.getByRole("button", { name: "Send test" }).click();
    await expect(page.getByText("Test message sent")).toBeVisible();
    const app = `/api/apps/${DEMO_APP_ID}`;
    expect(calls).toEqual([`PATCH ${app}/settings`, `POST ${app}/github/sync`, `POST ${app}/slack/test`]);
  });

  test("Add feedback: a recording uploads through the app's recordings routes", async ({ page }) => {
    const { DEMO_APP_ID } = fx();
    const calls = await stubAppApi(page);
    await page.goto("/demo/celeste/feedback");
    await page.getByRole("tab", { name: "Recording" }).click();
    await page.locator('input[type=file][accept*=".mp3"]').setInputFiles({ name: "call.mp3", mimeType: "audio/mpeg", buffer: Buffer.from("not really audio") });
    await page.getByLabel(/everyone in this recording agreed/i).check();
    await page.getByRole("button", { name: "Add recording" }).click();
    await expect(page.getByText(/transcribing now/i)).toBeVisible();
    const app = `/api/apps/${DEMO_APP_ID}/feedback/recordings`;
    expect(calls).toEqual([`POST ${app}/upload-url`, `POST ${app}`]);
  });
});
