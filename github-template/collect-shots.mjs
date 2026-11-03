// Copy to <target repo>/github-template/collect-shots.mjs
// Usage: before|after <frame ids…>  |  callback ready <pr_url> <pr_number>  |  callback failed <log_url>
// Runs as separate processes (before / after / callback), so state lives in /tmp/pma-shots.
// PNGs are PUT straight to Supabase Storage through the signed upload slots in the payload
// (never base64 in the callback: Vercel request bodies cap near 4.5 MB).
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const P = JSON.parse(process.env.P);
const SHOTS = "design/.local/shots";
const OUT = "/tmp/pma-shots";
const STATE = join(OUT, "state.json");
const MANIFEST = join(OUT, "manifest.json");
const MAX_PER_KIND = 12;
const MAX_BYTES = 2_000_000;
const [mode, ...args] = process.argv.slice(2);

// scene/frame ids only: no leading dash (option injection), no ".." segments.
const FRAME_ID = /^\w[\w-]*\/[\w./-]+$/;
const validFrame = (id) => FRAME_ID.test(id) && !id.split("/").includes("..");

// Marver renders agent-written frames; it must never see the callback token or signed upload URLs.
const childEnv = { ...process.env }; delete childEnv.P;

const load = (file, fallback) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; } };
const save = (file, data) => { mkdirSync(OUT, { recursive: true }); writeFileSync(file, JSON.stringify(data)); };

async function shoot(kind, frames) {
  const state = load(STATE, { next: 0 });
  const manifest = load(MANIFEST, { before: [], after: [] });
  for (const id of frames.filter(Boolean)) {
    if (!validFrame(id)) { console.warn(`skipping invalid frame id: ${JSON.stringify(id)}`); continue; }
    if (manifest[kind].length >= MAX_PER_KIND) { console.warn(`shot cap reached, skipping ${id}`); continue; }
    const slot = (P.upload_slots ?? [])[state.next];
    if (!slot) { console.warn("no upload slots left"); break; }
    rmSync(SHOTS, { recursive: true, force: true });
    try { execFileSync("npx", ["marver", "shot", id, "--scale", "1"], { stdio: "inherit", env: childEnv }); } catch { console.warn(`shot failed for ${id}`); continue; }
    const png = existsSync(SHOTS) ? readdirSync(SHOTS).find((f) => f.endsWith(".png") && !f.startsWith(".")) : null;
    if (!png) { console.warn(`no png for ${id}`); continue; }
    const file = join(SHOTS, png);
    if (statSync(file).size >= MAX_BYTES) { console.warn(`png too large for ${id}`); continue; }
    const res = await fetch(slot.url, { method: "PUT", headers: { "content-type": "image/png" }, body: readFileSync(file) });
    if (!res.ok) { console.warn(`upload failed for ${id}: ${res.status}`); continue; }
    state.next += 1; // a slot is single-use once uploaded
    manifest[kind].push({ frame_id: id, path: slot.path });
    save(STATE, state); save(MANIFEST, manifest);
  }
  save(STATE, state); save(MANIFEST, manifest);
}

async function post(body) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(P.callback_url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const text = await r.text();
      console.log("callback", r.status, text);
      if (r.ok) return;
      if (r.status < 500) throw new Error(`callback rejected: ${r.status}`);
      last = new Error(`callback ${r.status}`);
    } catch (e) {
      if (String(e.message).startsWith("callback rejected")) throw e;
      last = e;
    }
    await new Promise((res) => setTimeout(res, 2000 * attempt));
  }
  throw last;
}

async function callback(status, a, b) {
  const m = load(MANIFEST, { before: [], after: [] });
  const body = status === "ready"
    ? { draft_id: P.draft_id, token: P.callback_token, status, pr_url: a, pr_number: Number(b), before: m.before, after: m.after, marver_paths: m.after.map((s) => s.frame_id) }
    : { draft_id: P.draft_id, token: P.callback_token, status, log_url: a };
  await post(body);
}

if (mode === "before" || mode === "after") await shoot(mode, args);
else if (mode === "callback") await callback(args[0], args[1], args[2]);
else { console.error("usage: before|after <frames…> | callback ready <pr_url> <n> | callback failed <log_url>"); process.exit(2); }
