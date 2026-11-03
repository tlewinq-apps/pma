// Mock it up on a customer app with no design canvas (e2e-other's app), without calling a model: with no repository the
// issue page says to connect one; with a repository the button is offered ("Drawn approximately from your code"), and a
// first step that found no code is refused with a plain sentence before anything is drawn. The approximate drawing itself
// (Claude) is covered by tests/unit/codeMock.test.ts with fakes. Everything is put back afterwards.
import { existsSync, readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isProdUrl } from "../scripts/lib/guard";

type Fixtures = { OTHER_ORG: string; OTHER_APP: string; OTHER_ORG_APP_ID: string; OTHER_ORG_ISSUE_ID: string };
const fx = (): Fixtures => JSON.parse(readFileSync("e2e/.fixtures.json", "utf8"));

const CONNECT = "Connect your repository so PMA can draw this screen from your code.";
const LABEL = "Approximate mock-up drawn from your code. It isn't a screenshot.";
/** A 1×1 PNG, standing in for the drawn shots. */
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const NEEDS_CODE = "PMA needs the first step to find the code before it can draw this screen.";

function serviceClient(): SupabaseClient {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || isProdUrl(url)) throw new Error("e2e/codeMockup.spec.ts runs on the dev Supabase project only.");
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** A first step that read no code (feedback only), one recommended proposal with no screens, and `repo` on the app. */
async function withIssue(repo: string | null, fn: (issueId: string) => Promise<void>) {
  const { OTHER_ORG_APP_ID, OTHER_ORG_ISSUE_ID } = fx();
  const db = serviceClient();
  const { data: app, error: appError } = await db.from("projects").select("repo_full_name, watched_branch").eq("id", OTHER_ORG_APP_ID).single();
  expect(appError).toBeNull();
  const { data: issue, error } = await db.from("issues").select("diagnosis, status").eq("id", OTHER_ORG_ISSUE_ID).single();
  expect(error).toBeNull();
  const old = new Date(Date.now() - 3_600_000).toISOString();
  const finding = { headline: "The look is cut off in the popup.", facts: [], evidence: ["People scroll to see the shoes."], logging_added: [], where: "Result popup", confidence: "likely", source: { repo, ref: null, read: false } };
  const diagnosis = { status: "done", started_at: old, finished_at: old, steps: ["Read the feedback", "Wrote the finding from the feedback"], simulated: false, finding };
  expect((await db.from("projects").update({ repo_full_name: repo }).eq("id", OTHER_ORG_APP_ID)).error).toBeNull();
  expect((await db.from("issues").update({ diagnosis, status: "new" }).eq("id", OTHER_ORG_ISSUE_ID)).error).toBeNull();
  const { data: sol, error: solError } = await db.from("solutions").insert({
    issue_id: OTHER_ORG_ISSUE_ID, rank: 1, title: "E2E fit the look in the popup", summary: "The whole look fits in the popup, with the products below.",
    tradeoffs: "The look is smaller.", recommended: true, target_frames: [],
  }).select("id").single();
  expect(solError).toBeNull();
  try {
    await fn(OTHER_ORG_ISSUE_ID);
  } finally {
    await db.from("solutions").delete().eq("id", sol!.id);
    await db.from("issues").update({ diagnosis: issue!.diagnosis, status: issue!.status }).eq("id", OTHER_ORG_ISSUE_ID);
    await db.from("projects").update({ repo_full_name: app!.repo_full_name, watched_branch: app!.watched_branch }).eq("id", OTHER_ORG_APP_ID);
  }
}

test.describe("the admin of e2e-other", () => {
  test.use({ storageState: "e2e/.auth/other-admin.json" });

  test("is asked to connect the repository before a proposal with no screens can be mocked up", async ({ page }) => {
    const { OTHER_ORG, OTHER_APP } = fx();
    await withIssue(null, async (issueId) => {
      await page.goto(`/${OTHER_ORG}/${OTHER_APP}/issues/${issueId}`);
      await expect(page.getByText(CONNECT).first()).toBeVisible();
      await expect(page.getByText("isn't matched to a screen yet")).toHaveCount(0);
      await page.getByRole("button", { name: "Mock it up" }).click();
      await expect(page.getByRole("alert").filter({ hasText: CONNECT })).toBeVisible();
    });
  });

  test("can mock it up from the code once a repository is connected, and is told when the first step found none", async ({ page, request }) => {
    const { OTHER_ORG, OTHER_APP } = fx();
    await withIssue("acme/web-app", async (issueId) => {
      await page.goto(`/${OTHER_ORG}/${OTHER_APP}/issues/${issueId}`);
      await expect(page.getByText("Drawn approximately from your code.")).toBeVisible();
      await expect(page.getByText(CONNECT)).toHaveCount(0);
      await page.getByRole("button", { name: "Mock it up" }).click();
      await expect(page.getByRole("alert").filter({ hasText: NEEDS_CODE })).toBeVisible();

      const { data: sols } = await serviceClient().from("solutions").select("id").eq("issue_id", issueId).eq("title", "E2E fit the look in the popup");
      const res = await request.post(`/api/issues/${issueId}/draft`, { data: { solutionId: sols![0].id } });
      expect(res.status()).toBe(409);
      expect((await res.json()).error).toBe(NEEDS_CODE);
      const { count } = await serviceClient().from("drafts").select("id", { count: "exact", head: true }).eq("issue_id", issueId).eq("solution_id", sols![0].id);
      expect(count).toBe(0);
    });
  });

  test("sees a drawn mock-up labelled as approximate, with no pull request anywhere", async ({ page }) => {
    const { OTHER_ORG, OTHER_APP } = fx();
    await withIssue("acme/web-app", async (issueId) => {
      const db = serviceClient();
      const { data: sols } = await db.from("solutions").select("id").eq("issue_id", issueId).eq("title", "E2E fit the look in the popup");
      const shot = (side: string) => [{ frame_id: "code/result-popup", url: `${PIXEL}#${side}` }];
      const { data: draft, error } = await db.from("drafts").insert({
        issue_id: issueId, solution_id: sols![0].id, mode: "variant", backend: "mock", status: "ready", callback_token: "e2e".repeat(16), callback_used_at: new Date().toISOString(),
        pr_url: `http://localhost:3000/mock/pr/e2e`, pr_state: "open", before_images: shot("before"), after_images: shot("after"), marver_paths: [],
      }).select("id").single();
      expect(error).toBeNull();
      await db.from("issues").update({ status: "draft_ready" }).eq("id", issueId);
      try {
        await page.goto(`/${OTHER_ORG}/${OTHER_APP}/issues/${issueId}`);
        await expect(page.getByText(LABEL)).toBeVisible();
        // Approving it doesn't ship anything (spec call 11).
        await expect(page.getByRole("button", { name: "Approve the mock-up" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Approve and ship" })).toHaveCount(0);
        await expect(page.getByText("Review the mock-up: approve it, or ask for changes.")).toBeVisible();
        await expect(page.getByRole("link", { name: /PR/ })).toHaveCount(0);
        await expect(page.getByText(/Simulated draft|Mock runner/)).toHaveCount(0);

        // The shot opens the mock-up's own page (today and proposed at their own shape), not a pull request.
        await page.getByTitle("See this screen large, before and after").first().click({ timeout: 10_000 });
        await expect(page).toHaveURL(new RegExp(`/${OTHER_ORG}/${OTHER_APP}/mock/pr/${draft!.id}$`));
        await expect(page.getByText(LABEL)).toBeVisible();
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("E2E fit the look in the popup");
        await expect(page.getByText(/#\d+|Simulated pull request|Files changed/)).toHaveCount(0);
        await expect(page.getByRole("img", { name: "Proposed, approximate" })).toBeVisible();
      } finally {
        await db.from("drafts").delete().eq("id", draft!.id);
      }
    });
  });

  test("approves the mock-up: Ready to build, nobody told, and Copy task quotes what the mock-up changed", async ({ page }) => {
    const { OTHER_ORG, OTHER_APP } = fx();
    await withIssue("acme/web-app", async (issueId) => {
      const db = serviceClient();
      const { data: sols } = await db.from("solutions").select("id").eq("issue_id", issueId).eq("title", "E2E fit the look in the popup");
      const shot = (side: string) => [{ frame_id: "code/result-popup", url: `${PIXEL}#${side}` }];
      const changed = "The whole look now fits in the popup, with the products below it.";
      const { data: draft, error } = await db.from("drafts").insert({
        issue_id: issueId, solution_id: sols![0].id, mode: "variant", backend: "mock", status: "ready", callback_token: "e2e".repeat(16), callback_used_at: new Date().toISOString(),
        pr_url: `http://localhost:3000/mock/pr/e2e`, pr_state: "open", before_images: shot("before"), after_images: shot("after"), marver_paths: [],
        frames: [{ frame_id: "code/result-popup", path: "", changed }],
      }).select("id").single();
      expect(error).toBeNull();
      await db.from("issues").update({ status: "draft_ready" }).eq("id", issueId);
      const since = new Date().toISOString();
      try {
        await page.goto(`/${OTHER_ORG}/${OTHER_APP}/issues/${issueId}`);
        // The line on what changed shows, but no Marver caption and no full flow.
        await expect(page.getByText(changed)).toBeVisible();
        await expect(page.getByText("on the Marver canvas")).toHaveCount(0);
        await expect(page.getByRole("button", { name: /full flow/i })).toHaveCount(0);

        // Approving asks how it should be built first (e2e/buildHandoff.spec.ts covers the choice itself).
        await page.getByRole("button", { name: "Approve the mock-up" }).click();
        const approved = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/api/issues/${issueId}/approve`));
        await page.getByRole("button", { name: "Approve and hand off" }).click();
        expect((await approved).status()).toBe(200);
        await expect(page.getByText("Approved. Ready to build")).toBeVisible();
        await expect(page.getByText("Ready to build. Copy the task for Claude Code and link the pull request.")).toBeVisible();
        // Shipped is still ahead: the stepper's last step is current, and nothing says it shipped.
        await expect(page.getByRole("list", { name: "Progress" }).getByRole("listitem").filter({ hasText: "Shipped" })).toHaveAttribute("aria-current", "step");
        await expect(page.getByText(/^Shipped[.(]| shipped/)).toHaveCount(0);
        await expect(page.getByText("View the merged PR")).toHaveCount(0);

        const { data: issue } = await db.from("issues").select("status").eq("id", issueId).single();
        expect(issue!.status).toBe("ready_to_build");
        const { data: acts } = await db.from("activity").select("kind, payload").eq("issue_id", issueId).gte("at", since);
        expect(acts!.map((a) => a.kind)).toContain("approved");
        expect(acts!.find((a) => a.kind === "approved")!.payload).toMatchObject({ approximate: true });
        expect(acts!.map((a) => a.kind)).not.toContain("reporters_told");
        const { data: d } = await db.from("drafts").select("pr_state").eq("id", draft!.id).single();
        expect(d!.pr_state).toBe("open");

        // The next-step line points at the Copy task button.
        await page.getByRole("button", { name: "Copy the task for Claude Code", exact: true }).click();
        await expect(page.getByRole("button", { name: "Copy task for Claude Code" })).toBeFocused();
        const md = await (await page.request.get(`/api/issues/${issueId}/handoff?solution=${sols![0].id}`)).text();
        expect(md).toContain("In the approved mock-up:");
        expect(md).toContain(`- ${changed}`);

        // A second approval is refused.
        const again = await page.request.post(`/api/issues/${issueId}/approve`);
        expect(again.status()).toBe(409);
        expect((await again.json()).error).toBe("This mock-up is already approved.");
        // So is Request changes: it would re-draft and drop the approval.
        const changes = await page.request.post(`/api/issues/${issueId}/request-changes`, { data: { note: "Make it bigger" } });
        expect(changes.status()).toBe(409);
        expect((await changes.json()).error).toBe("This mock-up is already approved, so it can't be re-drafted. To build something else, mock up another proposal.");
        expect((await db.from("issues").select("status").eq("id", issueId).single()).data!.status).toBe("ready_to_build");
      } finally {
        await db.from("activity").delete().eq("issue_id", issueId).gte("at", since);
        await db.from("drafts").delete().eq("id", draft!.id);
      }
    });
  });

  test("a drawing whose run was killed reads as failed after ten minutes, with Retry", async ({ page }) => {
    const { OTHER_ORG, OTHER_APP } = fx();
    await withIssue("acme/web-app", async (issueId) => {
      const db = serviceClient();
      const { data: sols } = await db.from("solutions").select("id").eq("issue_id", issueId).eq("title", "E2E fit the look in the popup");
      const { data: draft, error } = await db.from("drafts").insert({
        issue_id: issueId, solution_id: sols![0].id, mode: "variant", backend: "mock", status: "dispatched", callback_token: "e2e".repeat(16),
        created_at: new Date(Date.now() - 11 * 60_000).toISOString(),
      }).select("id").single();
      expect(error).toBeNull();
      await db.from("issues").update({ status: "drafting" }).eq("id", issueId);
      try {
        await page.goto(`/${OTHER_ORG}/${OTHER_APP}/issues/${issueId}`);
        await expect(page.getByText("The mock-up didn't finish")).toBeVisible();
        await expect(page.getByText("The mock-up took too long. Try again.")).toBeVisible();
        await expect(page.getByRole("button", { name: "Retry" }).first()).toBeVisible();
        await expect(page.getByText("Drawing an approximate mock-up from your code")).toHaveCount(0);
      } finally {
        await db.from("drafts").delete().eq("id", draft!.id);
      }
    });
  });
});
