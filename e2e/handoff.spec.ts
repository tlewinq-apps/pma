// Copy task for Claude Code, on e2e-other's customer app: a proposal and a finished first step are put on its seeded
// issue through the service role (no model is called), the issue page offers the button, and the route returns the
// markdown task ending in the PMA marker. Someone outside the company gets a 404. Everything is put back afterwards.
import { existsSync, readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isProdUrl } from "../scripts/lib/guard";

type Fixtures = { OTHER_ORG: string; OTHER_APP: string; OTHER_ORG_ISSUE_ID: string };
const fx = (): Fixtures => JSON.parse(readFileSync("e2e/.fixtures.json", "utf8"));

function serviceClient(): SupabaseClient {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || isProdUrl(url)) throw new Error("e2e/handoff.spec.ts runs on the dev Supabase project only.");
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}

const FINDING = {
  headline: "The look modal gives the image a fixed height, so a tall look is cut off.",
  facts: [], evidence: ["People scroll inside the box to see the shoes."], logging_added: [], where: "Result modal", confidence: "likely",
  code_refs: [{ path: "src/screens/ResultModal.tsx", line: 42, note: "fixed height" }],
  source: { repo: "acme/web-app", ref: "main", read: true },
};

/** Runs `fn` with a done first step and one recommended proposal on e2e-other's issue, then restores the issue. */
async function withProposal(fn: (issue: { id: string; short_id: string }) => Promise<void>) {
  const { OTHER_ORG_ISSUE_ID } = fx();
  const db = serviceClient();
  const { data: before, error } = await db.from("issues").select("id, short_id, diagnosis").eq("id", OTHER_ORG_ISSUE_ID).single();
  expect(error).toBeNull();
  const old = new Date(Date.now() - 3_600_000).toISOString();
  const diagnosis = { status: "done", started_at: old, finished_at: old, steps: ["Read the feedback"], simulated: false, finding: FINDING };
  expect((await db.from("issues").update({ diagnosis }).eq("id", OTHER_ORG_ISSUE_ID)).error).toBeNull();
  const { data: sol, error: solError } = await db.from("solutions").insert({
    issue_id: OTHER_ORG_ISSUE_ID, rank: 1, title: "E2E fit the look in the box", summary: "Scale the image to fit the box, so the whole look shows.",
    tradeoffs: "Details get smaller.", recommended: true,
  }).select("id").single();
  expect(solError).toBeNull();
  try {
    await fn(before as { id: string; short_id: string });
  } finally {
    await db.from("solutions").delete().eq("id", sol!.id);
    await db.from("issues").update({ diagnosis: before!.diagnosis }).eq("id", OTHER_ORG_ISSUE_ID);
  }
}

test.describe("the admin of e2e-other", () => {
  test.use({ storageState: "e2e/.auth/other-admin.json" });

  test("gets the chosen proposal as a markdown task, from the issue page's button and the route", async ({ page, request }) => {
    const { OTHER_ORG, OTHER_APP } = fx();
    await withProposal(async (issue) => {
      const res = await request.get(`/api/issues/${issue.id}/handoff`);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("text/markdown");
      const md = await res.text();
      expect(md.trimEnd().split("\n").at(-1)).toBe(`PMA: ${issue.short_id}`);
      expect(md).toContain("## Files to start from");
      expect(md).toContain("`src/screens/ResultModal.tsx`");
      expect(md).toContain("E2E fit the look in the box");

      const download = await request.get(`/api/issues/${issue.id}/handoff?download=1`);
      expect(download.headers()["content-disposition"]).toBe(`attachment; filename="pma-${issue.short_id.toLowerCase()}.md"`);

      await page.goto(`/${OTHER_ORG}/${OTHER_APP}/issues/${issue.id}`);
      await expect(page.getByRole("button", { name: "Copy task for Claude Code" })).toBeVisible();
      // With no mock-up, Download task is the .md file (a .zip carries the mock-up images once there is one).
      await expect(page.getByRole("link", { name: "Download task" })).toHaveAttribute("href", /\/handoff\?solution=.+&download=1$/);
    });
  });
});

test("someone outside the company gets a 404 from the task route", async ({ request }) => {
  // The default state is the demo owner, who is not in e2e-other.
  const { OTHER_ORG_ISSUE_ID } = fx();
  const res = await request.get(`/api/issues/${OTHER_ORG_ISSUE_ID}/handoff`);
  expect(res.status()).toBe(404);
  expect(await res.text()).not.toContain("PMA:");
});

test("the demo's issue page keeps its proposals as they were, with no Copy task button", async ({ page }) => {
  const { DEMO_ISSUE_ID } = JSON.parse(readFileSync("e2e/.fixtures.json", "utf8")) as { DEMO_ISSUE_ID: string };
  await page.goto(`/demo/celeste/issues/${DEMO_ISSUE_ID}`);
  await expect(page.getByRole("heading", { name: /proposal/i }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy task for Claude Code" })).toHaveCount(0);
});
