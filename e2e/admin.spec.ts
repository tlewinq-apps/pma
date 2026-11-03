// The platform admin page (/admin: company invite links, counts only) and a company's members page
// (/<company>/settings/members), against the dev database. Runs as the demo owner unless a describe picks another
// person (e2e/global-setup.ts). Everything a test makes is deleted afterwards.
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isProdUrl } from "../scripts/lib/guard";

const LAST_OWNER = "A company needs at least one owner. Make someone else an owner first.";
const LINK = /\/invite\/[A-Za-z0-9_-]{43}$/;
const JOIN_LINK = /\/join\/[A-Za-z0-9_-]{43}$/;

function admin(): SupabaseClient {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || isProdUrl(url)) throw new Error("e2e/admin.spec.ts runs on the dev Supabase project only.");
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}

const rand = () => randomBytes(4).toString("hex");

async function userIdByEmail(db: SupabaseClient, email: string): Promise<string | null> {
  const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
  return data?.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
}

/** Deletes a teammate invite and, if inviting them made an account (the invite email went out), that account. */
async function deleteInvitee(db: SupabaseClient, email: string) {
  await db.from("member_invites").delete().eq("email", email);
  const id = await userIdByEmail(db, email);
  if (id) await db.auth.admin.deleteUser(id);
}

/** Invites `email` from the members page and returns the link it shows. */
async function invite(page: Page, email: string, role: "member" | "admin" = "member"): Promise<string> {
  const form = page.getByRole("region", { name: "Invite a teammate" });
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Role").selectOption(role);
  await form.getByRole("button", { name: "Send invite" }).click();
  await expect(form.getByText(new RegExp(`^(Invite sent to ${email.replace(/[.+]/g, "\\$&")}\\.|We couldn't email this invite\\. Copy the link and send it yourself\\.)$`))).toBeVisible();
  const field = form.getByLabel("Invite link");
  await expect(field).toHaveValue(JOIN_LINK);
  return field.inputValue();
}

test.describe("platform admin", () => {
  test.use({ storageState: "e2e/.auth/platform.json" });

  test("creates a company invite link shown once, and Revoke withdraws it", async ({ page }) => {
    const db = admin();
    const note = `e2e admin.spec ${rand()}`;
    try {
      await page.goto("/admin");
      const form = page.getByRole("region", { name: "Create invite link" });
      // Each field is named by its label, not by a placeholder.
      await expect(form.getByRole("textbox", { name: "Email", exact: true })).toBeVisible();
      await expect(form.getByRole("textbox", { name: "Note", exact: true })).toBeVisible();
      await expect(form.getByRole("combobox", { name: "Expires after", exact: true })).toBeVisible();
      await expect(form.getByRole("textbox", { name: "Optional" })).toHaveCount(0);
      await form.getByLabel("Note").fill(note);
      await form.getByLabel("Expires after").selectOption("1");
      await form.getByRole("button", { name: "Create invite link" }).click();
      const field = form.getByLabel("Invite link");
      await expect(field).toHaveValue(LINK);
      const link = await field.inputValue();
      await expect(form.getByText("Copy this link now. It won't be shown again.")).toBeVisible();

      // The pending list shows the new invite (anyone with the link, the note, its expiry) without the link itself.
      const row = page.getByRole("region", { name: "Pending invite links" }).getByRole("row").filter({ hasText: note });
      await expect(row).toContainText("Anyone with the link");
      await expect(row).not.toContainText(new URL(link).pathname.split("/").pop()!);
      const { data: stored } = await db.from("company_invites").select("expires_at, email").eq("note", note).single();
      expect(stored!.email).toBeNull();
      expect(Math.abs(Date.parse(stored!.expires_at) - Date.now() - 86_400_000)).toBeLessThan(10 * 60_000);

      await row.getByRole("button", { name: "Revoke" }).click();
      await expect(row).toHaveCount(0);
      await page.goto(new URL(link).pathname);
      await expect(page.getByText("This invite link was withdrawn.")).toBeVisible();
    } finally {
      await db.from("company_invites").delete().eq("note", note);
    }
  });

  test("an invite link can be locked to one address", async ({ page }) => {
    const db = admin();
    const note = `e2e admin.spec ${rand()}`, email = `e2e-locked-${rand()}@pma.test`;
    try {
      await page.goto("/admin");
      const form = page.getByRole("region", { name: "Create invite link" });
      await form.getByLabel("Email").fill(email);
      await form.getByLabel("Note").fill(note);
      await form.getByRole("button", { name: "Create invite link" }).click();
      await expect(form.getByLabel("Invite link")).toHaveValue(LINK);
      await expect(page.getByRole("region", { name: "Pending invite links" }).getByRole("row").filter({ hasText: note })).toContainText(email);
      const { data: stored } = await db.from("company_invites").select("expires_at, email").eq("note", note).single();
      expect(stored!.email).toBe(email);
      expect(Math.abs(Date.parse(stored!.expires_at) - Date.now() - 7 * 86_400_000)).toBeLessThan(10 * 60_000);
    } finally {
      await db.from("company_invites").delete().eq("note", note);
    }
  });

  test("sees counts only: no member emails and no links into companies", async ({ page }) => {
    await page.goto("/admin");
    const companies = page.getByRole("table", { name: "Companies" });
    const demoRow = companies.getByRole("row").filter({ hasText: "demo" });
    await expect(demoRow).toHaveCount(1);
    await expect(companies.getByRole("link")).toHaveCount(0);
    await expect(page.getByText("e2e-owner@pma.test")).toHaveCount(0);
    await expect(page.locator('a[href^="/demo"]')).toHaveCount(0);
  });

  test("is not let into a company's members page", async ({ page }) => {
    expect((await page.goto("/demo/settings/members"))!.status()).toBe(404);
  });
});

test.describe("not a platform admin", () => {
  for (const state of ["owner", "member", "no-org"]) {
    test(`${state} gets a 404 at /admin`, async ({ browser }) => {
      const context = await browser.newContext({ storageState: `e2e/.auth/${state}.json` });
      const page = await context.newPage();
      expect((await page.goto("/admin"))!.status()).toBe(404);
      await context.close();
    });
  }
});

test.describe("members page, as the demo owner", () => {
  test("Settings links to it", async ({ page }) => {
    await page.goto("/demo/celeste/settings");
    await page.getByRole("link", { name: "Company members" }).click();
    await expect(page).toHaveURL(/\/demo\/settings\/members$/);
    await expect(page.getByRole("heading", { name: "Company members" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to PMA" })).toHaveAttribute("href", /^\/demo\/celeste$/);
  });

  test("an owner invites a teammate, who shows under pending invites", async ({ page }) => {
    const db = admin();
    const email = `teammate+${rand()}@pma.test`;
    try {
      await page.goto("/demo/settings/members");
      await expect(page.getByRole("region", { name: "Members" }).getByText("e2e-owner@pma.test")).toBeVisible();
      await invite(page, email);
      const pending = page.getByRole("region", { name: "Pending invites" }).getByRole("listitem").filter({ hasText: email });
      await expect(pending).toContainText("Member");
    } finally {
      await deleteInvitee(db, email);
    }
  });

  test("Copy new link replaces a pending invite's link, and Revoke withdraws it", async ({ page, context }) => {
    const db = admin();
    const email = `teammate+${rand()}@pma.test`;
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    try {
      await page.goto("/demo/settings/members");
      const first = await invite(page, email, "admin");
      const row = page.getByRole("region", { name: "Pending invites" }).getByRole("listitem").filter({ hasText: email });
      await expect(row).toContainText("Admin");

      await row.getByRole("button", { name: "Copy new link" }).click();
      await expect(row.getByText("New link copied. The old link no longer works.")).toBeVisible();
      const second = await row.getByLabel("New invite link").inputValue();
      expect(second).toMatch(JOIN_LINK);
      expect(second).not.toBe(first);
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(second);

      // The old link is dead; the new one still works until it is withdrawn.
      const other = await context.newPage();
      await other.goto(new URL(first).pathname);
      await expect(other.getByText("This invite link isn't valid. Check you copied all of it.")).toBeVisible();

      await row.getByRole("button", { name: "Revoke" }).click();
      await expect(row).toHaveCount(0);
      await other.goto(new URL(second).pathname);
      await expect(other.getByText("This invite link was withdrawn.")).toBeVisible();
    } finally {
      await deleteInvitee(db, email);
    }
  });

  test("the only owner can neither remove nor demote themselves", async ({ page }) => {
    // A company of its own where the e2e owner is the only owner, so the test never depends on who else owns the demo.
    const db = admin();
    const slug = `e2e-solo-${rand()}`;
    const ownerId = await userIdByEmail(db, "e2e-owner@pma.test");
    const { data: org, error } = await db.from("organizations").insert({ name: "E2E Solo", slug }).select("id").single();
    if (error || !ownerId) throw new Error(`setup: ${error?.message ?? "no e2e owner"}`);
    try {
      await db.from("org_members").insert({ org_id: org.id, user_id: ownerId, role: "owner" });
      await db.from("projects").insert({ name: "Solo app", org_id: org.id, slug: "app", kind: "customer" });
      await page.goto(`/${slug}/settings/members`);
      const me = page.getByRole("region", { name: "Members" }).getByRole("listitem").filter({ hasText: "e2e-owner@pma.test" });

      await me.getByRole("button", { name: "Remove" }).click();
      await me.getByRole("button", { name: "Yes, remove" }).click();
      await expect(me.getByText(LAST_OWNER)).toBeVisible();

      await me.getByLabel("Role for e2e-owner@pma.test").selectOption("member");
      await expect(me.getByText(LAST_OWNER)).toBeVisible();
      await expect(me.getByLabel("Role for e2e-owner@pma.test")).toHaveValue("owner");
      const { data: rows } = await db.from("org_members").select("role").eq("org_id", org.id);
      expect(rows).toEqual([{ role: "owner" }]);
    } finally {
      const { error: cleanupError } = await db.from("organizations").delete().eq("id", org.id);
      if (cleanupError) throw new Error(`cleanup ${slug}: ${cleanupError.message}`);
    }
  });
});

test.describe("members page, as a plain member", () => {
  test.use({ storageState: "e2e/.auth/member.json" });

  test("sees a read-only list", async ({ page }) => {
    await page.goto("/demo/settings/members");
    const members = page.getByRole("region", { name: "Members" });
    await expect(members.getByText("e2e-owner@pma.test")).toBeVisible();
    await expect(members.getByText("e2e-member@pma.test")).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Invite a teammate" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Pending invites" })).toHaveCount(0);
  });

  test("Settings links to it for everyone", async ({ page }) => {
    await page.goto("/demo/celeste/settings");
    await expect(page.getByRole("link", { name: "Company members" })).toHaveAttribute("href", "/demo/settings/members");
  });
});

test.describe("members page, as an admin", () => {
  test.use({ storageState: "e2e/.auth/other-admin.json" });

  test("can invite but not change roles or remove anyone", async ({ page }) => {
    const db = admin();
    const email = `teammate+${rand()}@pma.test`;
    try {
      await page.goto("/e2e-other/settings/members");
      await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Members" }).getByRole("combobox")).toHaveCount(0);
      await invite(page, email);
      await expect(page.getByRole("region", { name: "Pending invites" }).getByText(email)).toBeVisible();
    } finally {
      await deleteInvitee(db, email);
    }
  });

  test("gets a 404 for a company they are not in", async ({ page }) => {
    expect((await page.goto("/demo/settings/members"))!.status()).toBe(404);
  });
});
