// npm run github:app -- dev|prod [--org <github org>] [--url <app url>] [--name <app name>]
//
// Registers the PMA GitHub App through GitHub's manifest flow. A page on localhost posts the manifest to GitHub;
// you check the name (GitHub app names are unique: if "PMA" is taken, pass --name) and click Create GitHub App.
// GitHub sends you back here with a one-time code, which is swapped for the app's id, keys and secrets
// (POST /app-manifests/{code}/conversions). dev writes them to .env.local; prod adds them to Vercel Production with
// `vercel env add`. Nothing secret is printed.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { githubAppManifest } from "../src/lib/github/manifest";

const args = process.argv.slice(2);
const target = args[0];
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
if (target !== "dev" && target !== "prod") {
  console.error("Usage: npm run github:app -- dev|prod [--org <github org>] [--url <app url>] [--name <app name>]");
  process.exit(1);
}
const prod = target === "prod";
const appUrl = opt("url") ?? (prod ? process.env.APP_URL ?? "" : "http://localhost:3000");
if (prod && !appUrl.startsWith("https://")) { console.error("The production app needs an https URL: pass --url or set APP_URL."); process.exit(1); }
const name = opt("name") ?? (prod ? "PMA" : "PMA Dev");
const org = opt("org");
const PORT = 4791;
const state = randomBytes(16).toString("hex");
const manifest = githubAppManifest({ appUrl, name, redirectUrl: `http://localhost:${PORT}/done`, webhook: prod });
const createUrl = `https://github.com/${org ? `organizations/${encodeURIComponent(org)}/` : ""}settings/apps/new?state=${state}`;

type Conversion = { id: number; slug: string; html_url: string; client_id: string; client_secret: string; webhook_secret: string | null; pem: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const page = `<!doctype html><meta charset="utf-8"><title>Register ${esc(name)}</title>
<body style="font-family:system-ui;margin:3rem"><p>Sending the ${esc(name)} manifest to GitHub…</p>
<form id="f" method="post" action="${esc(createUrl)}"><input type="hidden" name="manifest" value="${esc(JSON.stringify(manifest))}"><button>Continue to GitHub</button></form>
<script>document.getElementById("f").submit()</script></body>`;

/** The keys as env lines: the PEM on one line with its newlines escaped (src/lib/github/app.ts unescapes them). */
function envOf(c: Conversion): Record<string, string> {
  return {
    GITHUB_APP_ID: String(c.id), GITHUB_APP_SLUG: c.slug, GITHUB_APP_CLIENT_ID: c.client_id, GITHUB_APP_CLIENT_SECRET: c.client_secret,
    GITHUB_APP_PRIVATE_KEY: c.pem.trim().replace(/\r?\n/g, "\\n"), ...(c.webhook_secret ? { GITHUB_APP_WEBHOOK_SECRET: c.webhook_secret } : {}),
  };
}

function writeDotenv(vars: Record<string, string>) {
  const file = ".env.local";
  let text = existsSync(file) ? readFileSync(file, "utf8") : "";
  for (const [k, v] of Object.entries(vars)) {
    const line = `${k}="${v}"`;
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, () => line) : `${text.replace(/\n?$/, "\n")}${line}\n`;
  }
  writeFileSync(file, text);
}

function addToVercel(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) {
    const add = () => spawnSync("vercel", ["env", "add", k, "production"], { input: v, encoding: "utf8" });
    let r = add();
    if (r.status !== 0 && /already exists/i.test(`${r.stdout}${r.stderr}`)) {
      spawnSync("vercel", ["env", "rm", k, "production", "--yes"], { encoding: "utf8" });
      r = add();
    }
    console.log(r.status === 0 ? `  ${k}: added to Vercel Production` : `  ${k}: FAILED to add (run vercel env add ${k} production yourself)`);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname === "/") { res.writeHead(200, { "content-type": "text/html" }).end(page); return; }
  if (url.pathname !== "/done") { res.writeHead(404).end(); return; }
  const code = url.searchParams.get("code");
  if (url.searchParams.get("state") !== state || !code) { res.writeHead(400).end("That didn't come from this registration. Run the script again."); return; }
  try {
    const r = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
      method: "POST", headers: { accept: "application/vnd.github+json", "user-agent": "PMA", "x-github-api-version": "2022-11-28" },
    });
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
    const c = (await r.json()) as Conversion;
    const vars = envOf(c);
    console.log(`\nRegistered ${c.slug} (app id ${c.id}): ${c.html_url}`);
    if (prod) addToVercel(vars);
    else { writeDotenv(vars); console.log(`  Wrote ${Object.keys(vars).join(", ")} to .env.local`); }
    console.log("Restart the dev server (or redeploy production) so the app picks them up.");
    res.writeHead(200, { "content-type": "text/html" }).end(`<p style="font-family:system-ui;margin:3rem">${esc(c.slug)} is registered. You can close this tab.</p>`);
  } catch (e) {
    console.error("Swapping the code failed:", (e as Error).message);
    res.writeHead(500).end("Swapping the code failed. See the terminal.");
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  console.log(`Open http://localhost:${PORT}/ to register "${name}" for ${appUrl}${org ? ` under ${org}` : " on your own account"}.`);
  console.log("Check the name on GitHub, then click Create GitHub App.");
});
