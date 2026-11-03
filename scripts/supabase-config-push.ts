// npm run supabase:config-push — pushes supabase/config.toml's auth settings to the DEV project, and only there.
// config.toml is dev's configuration (site_url http://localhost:3000, localhost redirects, the sign-up hook, GitHub
// sign-in, MFA settings), and a plain `supabase config push` writes to whatever project this folder is linked to (and
// can apply without asking when an agent runs it). This refuses unless supabase/.temp/project-ref is the dev project
// (PMA_DEV_SUPABASE_REF in .env.local), always refuses production (PMA_PROD_SUPABASE_REF), and passes the dev ref
// explicitly. Production's auth settings change only in the dashboard
// or through the Management API. Takes --yes and --agent <auto|yes|no> (use --agent no to see the diff and answer the
// prompt yourself).
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prodRef } from "./lib/guard";

/** The dev project's ref, from PMA_DEV_SUPABASE_REF, or null when this checkout names none. */
export const devRef = (): string | null => process.env.PMA_DEV_SUPABASE_REF?.trim() || null;

/** Why config.toml can't be pushed to the project this folder is linked to, or null when it is dev. */
export function configPushProblem(ref: string | null, dev: string | null = devRef(), prod: string | null = prodRef()): string | null {
  if (!dev) return "Set PMA_DEV_SUPABASE_REF in .env.local to your dev project's ref first.";
  const LINK = `supabase link --project-ref ${dev}`;
  const linked = ref?.trim() ?? "";
  if (!linked) return `This folder isn't linked to a Supabase project (supabase/.temp/project-ref). Link it to dev first: ${LINK}`;
  if (prod && linked === prod) {
    return `Refusing: this folder is linked to the production project (${linked}). config.toml holds dev's auth settings; production's change only in the dashboard or the Management API. Relink to dev: ${LINK}`;
  }
  if (linked !== dev) return `Refusing: this folder is linked to ${linked}, not dev (${dev}). Relink to dev: ${LINK}`;
  return null;
}

const AGENT_VALUES = new Set(["auto", "yes", "no"]);

/** The supabase CLI arguments: always the dev ref, plus only --yes and --agent. Anything else is refused (a string). */
export function configPushArgs(extra: string[], dev: string = devRef() ?? ""): string[] | string {
  const refused = "supabase:config-push only takes --yes and --agent <auto|yes|no>; it always pushes to dev.";
  const out: string[] = [];
  for (let i = 0; i < extra.length; i++) {
    const a = extra[i];
    if (a === "--yes") out.push(a);
    else if (a.startsWith("--agent=") && AGENT_VALUES.has(a.slice("--agent=".length))) out.push(a);
    else if (a === "--agent" && AGENT_VALUES.has(extra[i + 1] ?? "")) out.push(a, extra[++i]);
    else return refused;
  }
  return ["config", "push", "--project-ref", dev, ...out];
}

function main(): number {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  let ref: string | null = null;
  try { ref = readFileSync(path.join(root, "supabase", ".temp", "project-ref"), "utf8"); } catch { /* not linked */ }
  const problem = configPushProblem(ref);
  if (problem) { console.error(problem); return 1; }
  const args = configPushArgs(process.argv.slice(2));
  if (typeof args === "string") { console.error(args); return 1; }
  console.log(`Pushing supabase/config.toml to dev (${devRef()}).`);
  const run = spawnSync("supabase", args, { cwd: root, stdio: "inherit" });
  if (run.error) { console.error(`Could not run the supabase CLI: ${run.error.message}`); return 1; }
  return run.status ?? 1;
}

// Run only when this file is the entry point, so the tests can import the checks without pushing anything.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main());
