// npm run cron:setup — schedules the database's 5-minute call to /api/cron/process (pg_cron + pg_net, migration 0017), because
// Vercel's Hobby plan only allows daily crons. Stores APP_URL and CRON_SECRET in Supabase Vault, then (re)creates the
// `pma-process` job; running it again is safe. Dev has no schedule on purpose: its APP_URL is localhost, which the
// database can't reach. Production, on purpose:
//   node --env-file=.env.prod.local --import tsx scripts/cron-setup.ts
// Deliberately no assertNotProd: running this against production is its whole purpose. Reads APP_URL, CRON_SECRET,
// NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment, and prints no secret.
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

/**
 * Why APP_URL can't be scheduled, or null when it can. It must be a full https URL (the cron secret travels as a bearer
 * token, so plain http would send it in the clear) whose host the database can reach, so never a loopback address.
 */
export function appUrlProblem(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch {
    return `APP_URL is "${url}", which isn't a full URL. Use the deployment's public address with its scheme, such as https://your-app.vercel.app.`;
  }
  // Loopback first, so http://localhost:3000 (what .env.local holds) gets the useful message rather than the https one.
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || /^127\./.test(host) || host === "[::1]" || host === "::1" || host === "0.0.0.0") {
    return `APP_URL is ${url}: the database can't reach your laptop. Run this with the public https URL of the deployment (see docs/self-hosting.md).`;
  }
  if (u.protocol !== "https:") {
    return `APP_URL is ${url}: it must be https, because the cron secret is sent as a bearer token with every call.`;
  }
  return null;
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set.`);
  return v;
}

async function main() {
  const appUrl = need("APP_URL");
  const secret = need("CRON_SECRET");
  // Checked before anything is written: a bad URL stored in Vault would leave a live job failing every 5 minutes.
  const problem = appUrlProblem(appUrl);
  if (problem) throw new Error(problem);

  const db = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const { error } = await db.rpc("set_cron_config", { p_app_url: appUrl, p_secret: secret });
  if (error) throw new Error(`set_cron_config failed: ${error.message} (is migration 0017 applied to this database?)`);

  console.log(`Scheduled pma-process every 5 minutes for ${new URL(appUrl).host}`);
}

// Run only when this file is the entry point, so the tests can import appUrlProblem without scheduling anything.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
