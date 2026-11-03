// Sign-up, against the dev database: setting up a company with no invite (open sign-up), creating one from a company
// invite, joining one from a member invite, and what a bad or used link says. No mailbox: the tests make the invite and the claim through the service
// role (as the /invite action and invite_member would) and sign in with an auth.admin.generateLink link opened at
// /auth/callback, the same way the emailed link arrives. Everything a test makes is deleted afterwards.
import { existsSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isProdUrl } from "../scripts/lib/guard";
import { magicLinkUrl } from "../src/lib/authLink";

const USED = "This invite link was already used. Ask for a new one.";

function admin(): SupabaseClient {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || isProdUrl(url)) throw new Error("e2e/invite.spec.ts runs on the dev Supabase project only.");
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}

const rand = () => randomBytes(4).toString("hex");
const newToken = () => randomBytes(32).toString("base64url");
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Opens a sign-in link for `email` the way the emailed one lands: /auth/callback with the token hash and `next`. */
async function signInThroughCallback(page: Page, db: SupabaseClient, email: string, next: string) {
  const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties?.hashed_token) throw new Error(`generateLink: ${error?.message ?? "no link"}`);
  const { hashed_token, verification_type } = data.properties;
  await page.goto(`/auth/callback?token_hash=${hashed_token}&type=${verification_type}&next=${encodeURIComponent(next)}`);
}

async function deleteUserByEmail(db: SupabaseClient, email: string) {
  const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
  const user = data?.users.find((u) => u.email?.toLowerCase() === email);
  if (user) await db.auth.admin.deleteUser(user.id);
}

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a company invite becomes a company: claim, sign-in link, create, welcome tour, and the link is then used up", async ({ page }) => {
    const db = admin();
    const token = newToken(), suffix = rand();
    const email = `e2e-invite-${suffix}@pma.test`;
    const { data: invite, error } = await db.from("company_invites")
      .insert({ token_hash: sha256(token), email, expires_at: new Date(Date.now() + 86_400_000).toISOString(), note: "e2e invite.spec" })
      .select("id").single();
    if (error) throw new Error(`insert company invite: ${error.message}`);
    let orgSlug: string | null = null;
    try {
      // Signed out, the page asks for the email, locked to the address the invite is for.
      await page.goto(`/invite/${token}`);
      const field = page.getByLabel("Email");
      await expect(field).toHaveValue(email);
      await expect(field).toHaveAttribute("readonly", "");

      // The claim startInviteSignIn would write, then the sign-in link. The before-user-created hook allows this address.
      const claim = await db.from("invite_claims").upsert({ email, company_invite_id: invite.id, expires_at: new Date(Date.now() + 3_600_000).toISOString() }, { onConflict: "email" });
      if (claim.error) throw new Error(`insert claim: ${claim.error.message}`);
      await signInThroughCallback(page, db, email, `/invite/${token}`);

      // Back on the invite, signed in: the create-company form, with neutral examples and labelled fields.
      await expect(page).toHaveURL(new RegExp(`/invite/${token}$`));
      await expect(page.getByRole("textbox", { name: "Company name", exact: true })).toHaveAttribute("placeholder", "Acme");
      await expect(page.getByRole("textbox", { name: "App name in links", exact: true })).toHaveAttribute("placeholder", "web-app");
      await page.getByLabel("Company name", { exact: true }).fill(`E2E Co ${suffix}`);
      await expect(page.getByLabel("Company name in links")).toHaveValue(`e2e-co-${suffix}`);
      await page.getByLabel("App name", { exact: true }).fill("Parent App");
      await expect(page.getByLabel("App name in links")).toHaveValue("parent-app");
      orgSlug = `e2e-co-${suffix}`;
      await page.getByRole("button", { name: "Create company" }).click();

      await expect(page).toHaveURL(new RegExp(`/${orgSlug}/parent-app/welcome\\?tour=1$`));
      const { data: org } = await db.from("organizations").select("id, name, org_members(role)").eq("slug", orgSlug).single();
      expect(org?.name).toBe(`E2E Co ${suffix}`);
      expect(org?.org_members).toEqual([{ role: "owner" }]);

      // The link is used up.
      await page.goto(`/invite/${token}`);
      await expect(page.getByText(USED)).toBeVisible();
    } finally {
      if (orgSlug) await db.from("organizations").delete().eq("slug", orgSlug);
      await db.from("company_invites").delete().eq("id", invite.id);
      await deleteUserByEmail(db, email);
    }
  });

  test("a member invite joins the company and opens its first app's welcome tour", async ({ page }) => {
    const db = admin();
    const token = newToken();
    const email = `e2e-join-${rand()}@pma.test`;
    const { data: other } = await db.from("organizations").select("id, name").eq("slug", "e2e-other").single();
    if (!other) throw new Error("global setup should have made the e2e-other company");
    const { data: invite, error } = await db.from("member_invites")
      .insert({ org_id: other.id, email, role: "member", token_hash: sha256(token), expires_at: new Date(Date.now() + 86_400_000).toISOString() })
      .select("id").single();
    if (error) throw new Error(`insert member invite: ${error.message}`);
    try {
      await page.goto(`/join/${token}`);
      await expect(page.getByText(`You're invited to join ${other.name} on PMA.`)).toBeVisible();
      await expect(page.getByLabel("Email")).toHaveValue(email);

      // No claim: the pending member invite is what lets the hook create this account.
      await signInThroughCallback(page, db, email, `/join/${token}`);
      await expect(page).toHaveURL(new RegExp(`/join/${token}$`));
      await page.getByRole("button", { name: `Join ${other.name}` }).click();
      await expect(page).toHaveURL(/\/e2e-other\/app\/welcome\?tour=1$/);

      await page.goto(`/join/${token}`);
      await expect(page.getByText(USED)).toBeVisible();
    } finally {
      await db.from("member_invites").delete().eq("id", invite.id);
      await deleteUserByEmail(db, email);
    }
  });

  test("the teammate invite email's link signs in and lands on the join page", async ({ page }, testInfo) => {
    // The members page sends Supabase's invite email with redirectTo <app>/auth/callback?next=/join/<token>, and
    // supabase/templates/invite.html links to {{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=invite. Dev's mailer
    // sends nothing to @pma.test, so build that same link from generateLink (the same token hash and redirect).
    const db = admin();
    const token = newToken();
    const email = `e2e-emailed-${rand()}@pma.test`;
    const { data: other } = await db.from("organizations").select("id, name").eq("slug", "e2e-other").single();
    if (!other) throw new Error("global setup should have made the e2e-other company");
    const { data: invite, error } = await db.from("member_invites")
      .insert({ org_id: other.id, email, role: "member", token_hash: sha256(token), expires_at: new Date(Date.now() + 86_400_000).toISOString() })
      .select("id").single();
    if (error) throw new Error(`insert member invite: ${error.message}`);
    try {
      const appUrl = process.env.APP_URL ?? testInfo.project.use.baseURL ?? "http://localhost:3000";
      const redirectTo = `${appUrl}/auth/callback?next=/join/${token}`;
      const { data, error: linkError } = await db.auth.admin.generateLink({ type: "invite", email, options: { redirectTo } });
      if (linkError || !data.properties?.hashed_token) throw new Error(`generateLink: ${linkError?.message ?? "no link"}`);
      // Auth kept our redirect (it is on the Site URL's host), so the template takes its RedirectTo branch.
      expect(data.properties.redirect_to).toBe(redirectTo);
      const emailed = `${data.properties.redirect_to}&token_hash=${data.properties.hashed_token}&type=invite`;
      await page.goto(new URL(emailed).pathname + new URL(emailed).search);
      await expect(page).toHaveURL(new RegExp(`/join/${token}$`));
      await page.getByRole("button", { name: `Join ${other.name}` }).click();
      await expect(page).toHaveURL(/\/e2e-other\/app\/welcome\?tour=1$/);
    } finally {
      await db.from("member_invites").delete().eq("id", invite.id);
      await deleteUserByEmail(db, email);
    }
  });

  test("when the sign-in email can't be sent, the invitee reads what to do, and the claim is already saved", async ({ page }) => {
    // Dev's mailer refuses @pma.test addresses, as it refused a real invitee's in the live run: the case to explain.
    const db = admin();
    const token = newToken();
    const email = `e2e-unsendable-${rand()}@pma.test`;
    const { data: invite, error } = await db.from("company_invites")
      .insert({ token_hash: sha256(token), email, expires_at: new Date(Date.now() + 86_400_000).toISOString(), note: "e2e invite.spec" })
      .select("id").single();
    if (error) throw new Error(`insert company invite: ${error.message}`);
    try {
      await page.goto(`/invite/${token}`);
      await page.getByRole("button", { name: "Send sign-in link" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "sign-in link" })).toHaveText(`We couldn't email a sign-in link to ${email}. Ask the person who invited you for a one-time sign-in link.`);
      const { data: claim } = await db.from("invite_claims").select("company_invite_id").eq("email", email).maybeSingle();
      expect(claim?.company_invite_id).toBe(invite.id);
    } finally {
      await db.from("company_invites").delete().eq("id", invite.id); // the claim goes with it
    }
  });

  test("an operator's one-time link signs a brand-new invitee in, and /no-company finishes their company without the link", async ({ page }) => {
    const db = admin();
    const token = newToken(), suffix = rand();
    const email = `e2e-claim-${suffix}@pma.test`;
    const { data: invite, error } = await db.from("company_invites")
      .insert({ token_hash: sha256(token), email, expires_at: new Date(Date.now() + 86_400_000).toISOString(), note: "e2e invite.spec" })
      .select("id").single();
    if (error) throw new Error(`insert company invite: ${error.message}`);
    const orgSlug = `e2e-claim-${suffix}`;
    try {
      // What the invite page saved before its email failed, then `npm run magic-link -- <email>` (no path).
      const claim = await db.from("invite_claims").upsert({ email, company_invite_id: invite.id, expires_at: new Date(Date.now() + 3_600_000).toISOString() }, { onConflict: "email" });
      if (claim.error) throw new Error(`insert claim: ${claim.error.message}`);
      const { data, error: linkError } = await db.auth.admin.generateLink({ type: "magiclink", email });
      if (linkError) throw new Error(`generateLink: ${linkError.message}`);
      // A brand-new address gets a signup token: verified as "magiclink" it failed as expired.
      expect(data.properties.verification_type).toBe("signup");
      const url = new URL(magicLinkUrl("http://localhost:3000", data.properties));
      await page.goto(url.pathname + url.search);

      await expect(page).toHaveURL(/\/no-company$/);
      await expect(page.getByRole("heading", { name: "Finish setting up your company" })).toBeVisible();
      await page.getByRole("link", { name: "Finish setting up your company" }).click();
      await expect(page).toHaveURL(/\/invite\/continue$/);
      expect(page.url()).not.toContain(token);
      await page.getByLabel("Company name", { exact: true }).fill(`E2E Claim ${suffix}`);
      await page.getByLabel("App name", { exact: true }).fill("Web app");
      await page.getByRole("button", { name: "Create company" }).click();
      await expect(page).toHaveURL(new RegExp(`/${orgSlug}/web-app/welcome\\?tour=1$`));
      await expect(page.getByRole("navigation", { name: "Setup steps" })).toBeVisible();

      const { data: used } = await db.from("company_invites").select("consumed_at").eq("id", invite.id).single();
      expect(used?.consumed_at).not.toBeNull();
      // The claim is spent: /invite/continue now says so.
      await page.goto("/invite/continue");
      await expect(page.getByText("There's no company invite waiting for this address any more.", { exact: false })).toBeVisible();
    } finally {
      await db.from("organizations").delete().eq("slug", orgSlug);
      await db.from("company_invites").delete().eq("id", invite.id);
      await deleteUserByEmail(db, email);
    }
  });

  test("a link that doesn't exist says so", async ({ page }) => {
    await page.goto(`/invite/${newToken()}`);
    await expect(page.getByText("This invite link isn't valid. Check you copied all of it.")).toBeVisible();
    await page.goto(`/join/${newToken()}`);
    await expect(page.getByText("This invite link isn't valid. Check you copied all of it.")).toBeVisible();
  });

  test("a gated page sends you to sign-in, and the link it asks for comes back to it and may make the account", async ({ page }) => {
    await page.goto("/work?view=x");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fwork%3Fview%3Dx$/);
    await expect(page.getByText("Feedback in, shipped fixes out.", { exact: false })).toBeVisible();
    // Answer the OTP request here: it would email a real link. Check what the form asked for instead.
    let sent: { redirect: string | null; body: Record<string, unknown> } | null = null;
    await page.route("**/auth/v1/otp*", async (route) => {
      sent = { redirect: new URL(route.request().url()).searchParams.get("redirect_to"), body: route.request().postDataJSON() };
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await page.getByPlaceholder("you@company.com").fill("someone@pma.test");
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    await expect(page.getByText("Check someone@pma.test for your sign-in link.", { exact: false })).toBeVisible();
    expect(sent!.body.create_user).toBe(true);
    expect(new URL(sent!.redirect!).pathname).toBe("/auth/callback");
    expect(new URL(sent!.redirect!).searchParams.get("next")).toBe("/work?view=x");
  });

  test("an address the mailer won't send to is told so in plain words", async ({ page }) => {
    // Supabase's built-in mailer refuses addresses outside the project's team until custom SMTP is set up.
    await page.route("**/auth/v1/otp*", (route) => route.fulfill({
      status: 400, contentType: "application/json",
      body: JSON.stringify({ code: 400, error_code: "email_address_not_authorized", msg: "Email address \"x@pma.test\" not authorized" }),
    }));
    await page.goto("/sign-in");
    await page.getByPlaceholder("you@company.com").fill(`e2e-nobody-${rand()}@pma.test`);
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    await expect(page.getByText("We couldn't email a sign-in link to that address yet.", { exact: false })).toBeVisible();
  });

  test("anyone signs up with no invite, sets up their own company on /no-company, and it runs on its own Claude key", async ({ page }) => {
    const db = admin();
    const suffix = rand();
    const email = `e2e-open-${suffix}@pma.test`;
    const orgSlug = `e2e-open-${suffix}`;
    try {
      // The emailed link for a brand-new address, opened as it arrives (no invite, no claim).
      await signInThroughCallback(page, db, email, "/");
      await expect(page).toHaveURL(/\/no-company$/);
      await expect(page.getByRole("heading", { name: "Set up your company" })).toBeVisible();
      await page.getByLabel("Company name", { exact: true }).fill(`E2E Open ${suffix}`);
      await page.getByLabel("App name", { exact: true }).fill("Web app");
      await page.getByRole("button", { name: "Create company" }).click();
      await expect(page).toHaveURL(new RegExp(`/${orgSlug}/web-app/welcome\\?tour=1$`));
      await expect(page.getByRole("heading", { name: "Welcome to PMA" })).toBeVisible();
      // No stand-in key: the Claude step's card says feedback waits for theirs.
      await page.goto(`/${orgSlug}/web-app/welcome?step=claude`);
      await expect(page.getByText("Feedback isn't read until a key is added.", { exact: false })).toBeVisible();

      const { data: org } = await db.from("organizations").select("id, self_serve").eq("slug", orgSlug).single();
      expect(org?.self_serve).toBe(true);
      const { data: members } = await db.from("org_members").select("role").eq("org_id", org!.id);
      expect(members).toEqual([{ role: "owner" }]);
      // In a company now: /no-company sends them to it.
      await page.goto("/no-company");
      await expect(page).toHaveURL(new RegExp(`/${orgSlug}/web-app`));
    } finally {
      await db.from("organizations").delete().eq("slug", orgSlug);
      await deleteUserByEmail(db, email);
    }
  });
});

test.describe("signed in as someone else", () => {
  test.use({ storageState: "e2e/.auth/no-org.json" });

  test("an invite for another address says so and offers to sign out", async ({ page }) => {
    const db = admin();
    const token = newToken();
    const { data: invite, error } = await db.from("company_invites")
      .insert({ token_hash: sha256(token), email: `e2e-someone-else-${rand()}@pma.test`, expires_at: new Date(Date.now() + 86_400_000).toISOString(), note: "e2e invite.spec" })
      .select("id").single();
    if (error) throw new Error(`insert company invite: ${error.message}`);
    try {
      await page.goto(`/invite/${token}`);
      await expect(page.getByText("This invite is for a different email address. Sign in with the address it was sent to.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Create company" })).toHaveCount(0);
    } finally {
      await db.from("company_invites").delete().eq("id", invite.id);
    }
  });
});
