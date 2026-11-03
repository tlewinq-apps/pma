// After a customer approves a mock-up, on e2e-other's customer app with no model call: "How should this be built?"
// (two pull-request ways shown but not available, Claude Code picked, saved as the app's default), Download task as a
// .zip with the real shots from Storage, the hand-off, Waiting for the pull request, Link pull request with a preview,
// and Mark as shipped. A member sees the steps but not the owner-only buttons; an outsider gets 404s; the demo app has
// no pull requests to link. At 1440 by 900 the issue page keeps to one screen (#sheet doesn't scroll) in the Review,
// Choice, Ready, Waiting and Linked states; with E2E_CLOSET_STATE set to a signed-in storage state for the Closet
// owner, the real Closet issue's Review state is measured too, read-only (it skips, saying so, if that issue isn't in
// the dev database or isn't in Review). Everything is put back afterwards.
import { existsSync, readFileSync } from "node:fs";
import { crc32, deflateSync, inflateRawSync } from "node:zlib";
import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isProdUrl } from "../scripts/lib/guard";

type Fixtures = { OTHER_ORG: string; OTHER_APP: string; OTHER_ORG_APP_ID: string; OTHER_ORG_ISSUE_ID: string; DEMO_ISSUE_ID: string };
const fx = (): Fixtures => JSON.parse(readFileSync("e2e/.fixtures.json", "utf8"));
const REPO = "acme/web-app";
/** A plain PNG of the given size: shots drawn from code for a web app are 1280 by 800. */
function makePng(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const row = Buffer.alloc(1 + w * 3, 0xe6); row[0] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}
const PNG = makePng(1280, 800);
const SCREEN = { width: 1440, height: 900 };

/** The owner's rule: the issue page fits one screen, so the sheet (the page's scroll container) doesn't scroll. */
async function expectOneScreen(page: Page, where: string) {
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await expect.poll(async () => page.evaluate(() => { const s = document.getElementById("sheet")!; return s.scrollHeight - s.clientHeight; }), { message: `${where}: #sheet scrolls` }).toBeLessThanOrEqual(0);
}
const CHANGED = "The whole look now fits in the popup, with the products below it.";
const FRAME = "export default function Frame() { return <div data-pma=\"look\">Your look</div>; }";

function serviceClient(): SupabaseClient {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || isProdUrl(url)) throw new Error("e2e/buildHandoff.spec.ts runs on the dev Supabase project only.");
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** The names of a .zip's entries and each entry's bytes (stored or deflated). */
function unzipNames(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = buf.readUInt32LE(end + 16);
  for (let k = 0; k < buf.readUInt16LE(end + 10); k++) {
    const method = buf.readUInt16LE(at + 10), size = buf.readUInt32LE(at + 20), n = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + size);
    out.set(buf.subarray(at + 46, at + 46 + n).toString(), method === 8 ? inflateRawSync(body) : Buffer.from(body));
    at += 46 + n + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return out;
}

/**
 * e2e-other's issue with a finished first step, one proposal and an approximate mock-up ready for review, whose shots
 * are real PNGs in the shots bucket. Restores the issue, the app's repository and settings, and removes what it made.
 */
async function withReadyMockup(fn: (ids: { issueId: string; shortId: string; draftId: string; solutionId: string }) => Promise<void>) {
  const { OTHER_ORG_APP_ID, OTHER_ORG_ISSUE_ID } = fx();
  const db = serviceClient();
  const { data: app } = await db.from("projects").select("repo_full_name, watched_branch, settings").eq("id", OTHER_ORG_APP_ID).single();
  const { data: issue } = await db.from("issues").select("short_id, diagnosis, status, owner_id").eq("id", OTHER_ORG_ISSUE_ID).single();
  const old = new Date(Date.now() - 3_600_000).toISOString();
  const finding = { headline: "The look modal gives the image a fixed height.", facts: [], evidence: [], logging_added: [], where: "Result popup", confidence: "likely",
    code_refs: [{ path: "src/screens/ResultModal.tsx", line: 42, note: "fixed height" }], source: { repo: REPO, ref: "main", read: true } };
  expect((await db.from("projects").update({ repo_full_name: REPO, settings: {} }).eq("id", OTHER_ORG_APP_ID)).error).toBeNull();
  expect((await db.from("issues").update({ diagnosis: { status: "done", started_at: old, finished_at: old, steps: ["Read the feedback"], simulated: false, finding }, status: "draft_ready", owner_id: null }).eq("id", OTHER_ORG_ISSUE_ID)).error).toBeNull();
  const { data: sol } = await db.from("solutions").insert({ issue_id: OTHER_ORG_ISSUE_ID, rank: 1, title: "E2E fit the look in the popup", summary: "The whole look fits in the popup.", tradeoffs: "The look is smaller.", recommended: true, target_frames: [] }).select("id").single();
  const { data: draft, error } = await db.from("drafts").insert({
    issue_id: OTHER_ORG_ISSUE_ID, solution_id: sol!.id, mode: "variant", backend: "mock", status: "ready", callback_token: "e2e".repeat(16), callback_used_at: new Date().toISOString(),
    pr_url: "http://localhost:3000/mock/pr/e2e", pr_state: "open", marver_paths: [], frames: [{ frame_id: "code/result-popup", path: "", changed: CHANGED, source: FRAME }],
  }).select("id").single();
  expect(error).toBeNull();
  const paths = [0, 1].map((n) => `${OTHER_ORG_ISSUE_ID}/${draft!.id}/slot-${n}.png`);
  for (const p of paths) expect((await db.storage.from("shots").upload(p, PNG, { contentType: "image/png", upsert: true })).error).toBeNull();
  const shot = (p: string) => [{ frame_id: "code/result-popup", url: db.storage.from("shots").getPublicUrl(p).data.publicUrl }];
  expect((await db.from("drafts").update({ before_images: shot(paths[0]), after_images: shot(paths[1]) }).eq("id", draft!.id)).error).toBeNull();
  const since = new Date().toISOString();
  try {
    await fn({ issueId: OTHER_ORG_ISSUE_ID, shortId: issue!.short_id, draftId: draft!.id, solutionId: sol!.id });
  } finally {
    await db.storage.from("shots").remove(paths);
    await db.from("pull_request_links").delete().eq("issue_id", OTHER_ORG_ISSUE_ID);
    await db.from("activity").delete().eq("issue_id", OTHER_ORG_ISSUE_ID).gte("at", since);
    await db.from("drafts").delete().eq("id", draft!.id);
    await db.from("solutions").delete().eq("id", sol!.id);
    await db.from("issues").update({ diagnosis: issue!.diagnosis, status: issue!.status, owner_id: issue!.owner_id }).eq("id", OTHER_ORG_ISSUE_ID);
    await db.from("projects").update({ repo_full_name: app!.repo_full_name, watched_branch: app!.watched_branch, settings: app!.settings ?? {} }).eq("id", OTHER_ORG_APP_ID);
  }
}

test.describe("the admin of e2e-other", () => {
  test.use({ storageState: "e2e/.auth/other-admin.json", viewport: SCREEN });

  test("approves with a build choice, hands it off with the images, links the pull request and marks it shipped", async ({ page, context }) => {
    const { OTHER_ORG, OTHER_APP, OTHER_ORG_APP_ID } = fx();
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await withReadyMockup(async ({ issueId, shortId, solutionId }) => {
      const db = serviceClient();
      await page.goto(`/${OTHER_ORG}/${OTHER_APP}/issues/${issueId}`);
      await expect(page.getByRole("button", { name: "Approve the mock-up" })).toBeVisible();
      await expectOneScreen(page, "Review");

      // How should this be built? (a pop-up, so the page stays one screen)
      await page.getByRole("button", { name: "Approve the mock-up" }).click();
      await expect(page.getByText("How should this be built?", { exact: true })).toBeVisible();
      await expectOneScreen(page, "Choice");
      await expect(page.getByRole("radio", { name: "New pull request" })).toBeDisabled();
      await expect(page.getByRole("radio", { name: "Add to an existing branch" })).toBeDisabled();
      await expect(page.getByRole("radio", { name: "Hand off to Claude Code" })).toBeChecked();
      await expect(page.getByText("Needs the PMA GitHub App — coming next")).toHaveCount(2);
      await expect(page.getByText(/fresh branch from your default branch/)).toBeVisible();
      await expect(page.getByText(/task and the mock-up images/)).toBeVisible();
      // Why not yet sits behind a toggle.
      await page.getByRole("button", { name: "Why can't PMA open the pull request yet?" }).click();
      await expect(page.getByText(/through its GitHub App/)).toBeVisible();
      // Cancel goes back to the review buttons.
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("button", { name: "Request changes" })).toBeVisible();
      await page.getByRole("button", { name: "Approve the mock-up" }).click();
      await page.getByLabel("Make this the default for this app").check();
      const approved = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/api/issues/${issueId}/approve`));
      const saved = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().endsWith(`/api/apps/${OTHER_ORG_APP_ID}/build`));
      await page.getByRole("button", { name: "Approve and hand off" }).click();
      expect((await approved).status()).toBe(200);
      expect((await saved).status()).toBe(200);
      await expect(page.getByText("Approved. Ready to build")).toBeVisible();
      expect((await db.from("issues").select("status").eq("id", issueId).single()).data!.status).toBe("ready_to_build");
      expect((await db.from("projects").select("settings").eq("id", OTHER_ORG_APP_ID).single()).data!.settings).toMatchObject({ build: { mode: "claude_code" } });
      const { data: acts } = await db.from("activity").select("kind, payload").eq("issue_id", issueId).eq("kind", "approved");
      expect(acts!.at(-1)!.payload).toMatchObject({ approximate: true, build: "claude_code" });

      // The path out: Ready to build, Pull request, Preview, Shipped; first, hand it to Claude Code.
      const track = page.getByRole("list", { name: "On the way to shipped" });
      await expect(track).toContainText("Ready to build");
      await expect(track).toContainText("Pull request");
      await expect(track).toContainText("Preview (optional)");
      await expect(track).toContainText("Shipped");
      await expect(page.getByText("Next: hand it to Claude Code")).toBeVisible();
      await expect(page.getByText("Ready to build. Copy the task for Claude Code and link the pull request.")).toBeVisible();
      await expectOneScreen(page, "Ready");
      const download = page.getByRole("link", { name: "Download task" });
      await expect(download).toHaveAttribute("href", new RegExp(`/api/issues/${issueId}/handoff\\?solution=${solutionId}&format=zip$`));

      // Download task: task.md, the two shots from Storage, and the layout code.
      const zip = await page.request.get(`/api/issues/${issueId}/handoff?solution=${solutionId}&format=zip`);
      expect(zip.status()).toBe(200);
      expect(zip.headers()["content-type"]).toBe("application/zip");
      expect(zip.headers()["content-disposition"]).toBe(`attachment; filename="pma-${shortId.toLowerCase()}.zip"`);
      const files = unzipNames(Buffer.from(await zip.body()));
      expect([...files.keys()]).toEqual(["task.md", "today.png", "proposed.png", "proposed-frame.tsx"]);
      expect(files.get("today.png")!.equals(PNG)).toBe(true);
      const md = files.get("task.md")!.toString();
      expect(md).toContain("## The approved mock-up");
      expect(md).toContain("`today.png`");
      expect(md).toContain(`- ${CHANGED}`);
      expect(md.trimEnd().split("\n").at(-1)).toBe(`PMA: ${shortId}`);
      expect(files.get("proposed-frame.tsx")!.toString()).toContain("Layout reference from PMA's approved mock-up");

      // Copy task: recorded as the hand-off, and the issue waits for the pull request.
      await page.getByRole("button", { name: "Copy task for Claude Code" }).click();
      await expect(page.getByText("Waiting for the pull request", { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Waiting for the pull request. Link it here once your engineers open it.")).toBeVisible();
      await expectOneScreen(page, "Waiting");
      // Copy task and Download task are actions, so they stay in view; only the explanation sits behind a toggle.
      const how = page.getByRole("button", { name: "How the pull request gets linked" });
      await expect(how).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("button", { name: "Copy task for Claude Code" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Download task" })).toBeVisible();
      await how.click();
      await expect(how).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByText(`PMA: ${shortId}`, { exact: true })).toBeVisible();
      await expect(page.getByText(/Once the PMA GitHub App is connected \(coming next\)/)).toBeVisible();

      // Link pull request: the wrong repository is refused, then the right one with its preview.
      await page.getByRole("button", { name: "Link pull request" }).click();
      await page.getByLabel("Pull request link").fill("https://github.com/someone-else/web-app/pull/42");
      await page.getByRole("button", { name: "Link", exact: true }).click();
      await expect(page.getByText(`That pull request isn't in the repository this app is connected to (${REPO}).`)).toBeVisible();
      await page.getByLabel("Pull request link").fill(`https://github.com/${REPO}/pull/42/files`);
      await page.getByLabel("Preview link (optional)").fill("https://web-app-git-fix.vercel.app");
      await page.getByRole("button", { name: "Link", exact: true }).click();
      await expect(page.getByRole("link", { name: "Pull request #42" })).toHaveAttribute("href", `https://github.com/${REPO}/pull/42`);
      await expect(page.getByRole("link", { name: "See it live" })).toHaveAttribute("href", "https://web-app-git-fix.vercel.app/");
      await expect(page.getByText("Pull request linked. Mark it shipped once it merges, and PMA tells the people who raised it.")).toBeVisible();
      // Marking it shipped tells everyone who raised it, so the warning is text under the button, not a tooltip.
      const shipButton = page.getByRole("button", { name: "Mark as shipped" });
      await expect(page.getByText("Once it has merged. Everyone who raised it in Slack is told it shipped.", { exact: true })).toBeVisible();
      await expect(shipButton).toHaveAccessibleDescription("Once it has merged. Everyone who raised it in Slack is told it shipped.");
      expect(await shipButton.getAttribute("title")).toBeNull();
      // One short line at 12px type, directly under the button.
      const note = (await page.getByText("Once it has merged.", { exact: false }).boundingBox())!;
      const buttonBox = (await shipButton.boundingBox())!;
      expect(note.height).toBeLessThan(20);
      expect(note.y).toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height);
      expect(note.y - (buttonBox.y + buttonBox.height)).toBeLessThan(16);
      expect(Math.abs(note.x - buttonBox.x)).toBeLessThan(4);
      await expectOneScreen(page, "Linked");

      // Mark as shipped, after the confirm sentence.
      let asked = "";
      page.once("dialog", (d) => { asked = d.message(); void d.accept(); });
      await page.getByRole("button", { name: "Mark as shipped" }).click();
      await expect(page.getByText(/^Shipped/).first()).toBeVisible();
      expect(asked).toBe("Mark this as shipped? Do this once the pull request has merged. Everyone who raised it in Slack will be told it shipped.");
      await expect.poll(async () => (await db.from("issues").select("status").eq("id", issueId).single()).data!.status).toBe("shipped");
      const { data: links } = await db.from("pull_request_links").select("state, url, preview_url").eq("issue_id", issueId);
      expect(links).toEqual([{ state: "merged", url: `https://github.com/${REPO}/pull/42`, preview_url: "https://web-app-git-fix.vercel.app/" }]);
      const kinds = (await db.from("activity").select("kind").eq("issue_id", issueId)).data!.map((a) => a.kind);
      expect(kinds).toEqual(expect.arrayContaining(["approved", "handed_off", "pr_linked", "shipped"]));
    });
  });
});

test.describe("a member of e2e-other", () => {
  test.use({ storageState: "e2e/.auth/two-orgs.json" });

  test("sees where it stands, but linking and shipping are for owners, admins and the issue's owner", async ({ page }) => {
    const { OTHER_ORG, OTHER_APP } = fx();
    await withReadyMockup(async ({ issueId }) => {
      const db = serviceClient();
      await db.from("issues").update({ status: "ready_to_build" }).eq("id", issueId);
      await db.from("activity").insert({ issue_id: issueId, kind: "approved", payload: { mock: true, approximate: true, build: "claude_code" } });
      await db.from("activity").insert({ issue_id: issueId, kind: "handed_off", payload: { via: "copy" } });
      await page.goto(`/${OTHER_ORG}/${OTHER_APP}/issues/${issueId}`);
      await expect(page.getByText("Waiting for the pull request", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Link pull request" })).toHaveCount(0);
      await page.getByRole("button", { name: "How the pull request gets linked" }).click();
      await expect(page.getByText(/an owner, an admin or the person who owns this issue can/)).toBeVisible();
      const res = await page.request.post(`/api/issues/${issueId}/pull-requests`, { data: { url: `https://github.com/${REPO}/pull/7` } });
      expect(res.status()).toBe(403);

      // A linked pull request: a member is told an owner or admin ships it, and can't.
      await db.from("pull_request_links").insert({ issue_id: issueId, url: `https://github.com/${REPO}/pull/7`, repo: REPO, number: 7 });
      await page.reload();
      await expect(page.getByText("Pull request linked. An owner or admin marks it shipped once it merges.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Mark as shipped" })).toHaveCount(0);
      await expect(page.getByText("Everyone who raised it in Slack is told it shipped.")).toHaveCount(0);
      expect((await page.request.post(`/api/issues/${issueId}/ship`)).status()).toBe(403);
      expect((await db.from("issues").select("status").eq("id", issueId).single()).data!.status).toBe("ready_to_build");
    });
  });
});

test("someone outside the company gets 404s, and the demo app has no pull requests to link", async ({ request, page }) => {
  // The default state is the demo owner, who is not in e2e-other.
  const { OTHER_ORG_ISSUE_ID, DEMO_ISSUE_ID, OTHER_ORG_APP_ID } = fx();
  expect((await request.post(`/api/issues/${OTHER_ORG_ISSUE_ID}/pull-requests`, { data: { url: `https://github.com/${REPO}/pull/7` } })).status()).toBe(404);
  expect((await request.post(`/api/issues/${OTHER_ORG_ISSUE_ID}/ship`)).status()).toBe(404);
  expect((await request.get(`/api/issues/${OTHER_ORG_ISSUE_ID}/handoff?format=zip`)).status()).toBe(404);
  expect((await request.put(`/api/apps/${OTHER_ORG_APP_ID}/build`, { data: { mode: "claude_code" } })).status()).toBe(404);
  expect((await request.post(`/api/issues/${DEMO_ISSUE_ID}/pull-requests`, { data: { url: "https://github.com/a/b/pull/1" } })).status()).toBe(409);
  await page.goto(`/demo/celeste/issues/${DEMO_ISSUE_ID}`);
  await expect(page.getByRole("heading", { name: /proposal/i }).first()).toBeVisible();
  await expect(page.getByText("How should this be built?")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "On the way to shipped" })).toHaveCount(0);
});

// The real Closet issue (a customer issue with a ready approximate mock-up drawn from its code), measured read-only:
// nothing is approved or changed. It lives in the dev database under the real Closet company, not in an e2e one, so
// e2e/.fixtures.json can't provide it: it is found by id (E2E_CLOSET_ISSUE, else the one below) and the test skips,
// saying why, when that issue is gone or no longer in Review. Needs a signed-in storage state for the Closet owner in
// E2E_CLOSET_STATE.
const CLOSET_ISSUE = process.env.E2E_CLOSET_ISSUE ?? "566eedc8-4390-412f-832c-43179f61d9e1";
test.describe("the real Closet issue", () => {
  const state = process.env.E2E_CLOSET_STATE;
  test.skip(!state, "set E2E_CLOSET_STATE to a signed-in storage state for the Closet owner");
  test.use({ storageState: state ?? "e2e/.auth/owner.json", viewport: SCREEN });

  test("fits one screen in its Review state, and with the build choice open", async ({ page }) => {
    const { data: issue } = await serviceClient().from("issues").select("id, status, projects(slug, organizations(slug))").eq("id", CLOSET_ISSUE).maybeSingle();
    if (!issue) { test.skip(true, `The Closet issue ${CLOSET_ISSUE} isn't in the dev database. Set E2E_CLOSET_ISSUE to a Closet issue that is in Review.`); return; }
    if (issue.status !== "draft_ready" && issue.status !== "in_review") { test.skip(true, `The Closet issue ${CLOSET_ISSUE} is ${issue.status}, not in Review. Set E2E_CLOSET_ISSUE to one that is.`); return; }
    const app = issue.projects as unknown as { slug: string; organizations: { slug: string } } | null;
    if (!app) { test.skip(true, `The Closet issue ${CLOSET_ISSUE} has no app.`); return; }
    await page.goto(`/${app.organizations.slug}/${app.slug}/issues/${issue.id}`);
    const approve = page.getByRole("button", { name: "Approve the mock-up" });
    await expect(approve).toBeVisible();
    await expectOneScreen(page, "Closet review");
    await approve.click();
    await expect(page.getByText("How should this be built?", { exact: true })).toBeVisible();
    await expectOneScreen(page, "Closet choice");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("How should this be built?", { exact: true })).toHaveCount(0);
  });
});
