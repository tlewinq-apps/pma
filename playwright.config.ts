import { defineConfig } from "@playwright/test";

// Run `npm run dev` yourself (or point E2E_URL at a dev deployment). e2e/global-setup.ts makes the e2e people and
// companies on the dev database and saves their sign-in states in e2e/.auth/; tests run as the demo owner unless
// they pick another state (member, two-orgs, no-org, platform). Ids tests need are in e2e/.fixtures.json.
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  // One worker: several specs edit the shared e2e-other fixture (its app's repository, profile and issue), so they
  // must not run at the same time.
  workers: 1,
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: process.env.E2E_URL ?? "http://localhost:3000",
    storageState: "e2e/.auth/owner.json",
  },
});
