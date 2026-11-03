// An app's product profile, first drafted from what its repository says about itself: the package and app names, the
// README, the top-level folders and the names of its screen, page and route files. The model turns those facts into a
// profile; the owner then checks and edits it on Start here (profileEdit validates what they save). Everything read from
// the repository is untrusted data: it is quoted to the model, which is told never to follow it.
import type { StructuredCaller } from "@/lib/llm/client";
import { PROFILE_FROM_REPO } from "@/lib/llm/prompts";
import { ProfileOut } from "@/lib/pipeline/schemas";
import type { RepoSnapshot } from "@/lib/repo/snapshot";
import { GENERIC_PROFILE, PLATFORMS, parseProfile, type ProductProfile } from "./profile";

const README_CHARS = 3000;
const MAX_SCREENS = 60;
const MAX_DIRS = 30;
/** Dependencies worth naming: they say what kind of app it is (an Expo app with web files ships web and mobile). */
const FRAMEWORKS = ["expo", "react-native", "react-native-web", "next", "react", "vue", "nuxt", "svelte", "@sveltejs/kit", "astro", "@angular/core", "remix", "@remix-run/react", "electron", "@capacitor/core", "@ionic/react", "solid-js", "gatsby", "flutter"];
const CODE_FILE = /\.(tsx|jsx|ts|js|mjs|vue|svelte|astro|dart|swift|kt|rb|py|php|html|erb)$/i;
const SCREEN_DIR = /(^|\/)(screens?|pages?|routes?|views?|app)\//i;
const SCREEN_FILE = /(Screen|Page|View|Route)(\.(web|native|ios|android))?\.[a-z]+$/;

export type RepoFacts = {
  repo: string; packageName: string | null; packageDescription: string | null; appName: string | null;
  frameworks: string[]; readme: string | null; topDirs: string[]; screens: string[];
};

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};
const json = (s: string | null): Record<string, unknown> | null => {
  if (!s) return null;
  try { const v = JSON.parse(s); return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null; } catch { return null; }
};
/** The shallowest listed path whose file name matches, so a monorepo's root file wins over a package's. */
function shallowest(paths: string[], name: RegExp): string | null {
  return paths.filter((p) => name.test(p.split("/").pop() ?? "")).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))[0] ?? null;
}

/** What the repository says about the product, read from a handful of files and the file list. */
export function repoFacts(snap: RepoSnapshot): RepoFacts {
  const paths = snap.files().map((f) => f.path);
  const pkgPath = shallowest(paths, /^package\.json$/);
  const pkg = json(pkgPath ? snap.read(pkgPath) : null);
  const deps = { ...(pkg?.dependencies as object | undefined), ...(pkg?.devDependencies as object | undefined) } as Record<string, unknown>;

  // An Expo app's display name: app.json's expo.name (or name), else a name: "..." in app.config.*.
  let appName: string | null = null;
  const appJsonPath = shallowest(paths, /^app\.json$/);
  const appJson = json(appJsonPath ? snap.read(appJsonPath) : null);
  if (appJson) appName = text((appJson.expo as Record<string, unknown> | undefined)?.name, 80) ?? text(appJson.name, 80);
  if (!appName) {
    const configPath = shallowest(paths, /^app\.config\.(ts|js|mjs|cjs|json)$/);
    const m = configPath ? /\bname\s*:\s*["'`]([^"'`\n]{1,80})["'`]/.exec(snap.read(configPath) ?? "") : null;
    appName = m ? text(m[1], 80) : null;
  }

  const readmePath = shallowest(paths, /^readme(\.[a-z]+)?$/i);
  const readme = readmePath ? (snap.read(readmePath) ?? "").slice(0, README_CHARS).trim() || null : null;
  const topDirs = [...new Set(paths.filter((p) => p.includes("/")).map((p) => p.split("/")[0]))].sort().slice(0, MAX_DIRS);
  const screens = paths.filter((p) => CODE_FILE.test(p) && (SCREEN_DIR.test(p) || SCREEN_FILE.test(p))).slice(0, MAX_SCREENS);

  return {
    repo: snap.repo, packageName: text(pkg?.name, 120), packageDescription: text(pkg?.description, 400), appName,
    frameworks: FRAMEWORKS.filter((f) => f in deps), readme, topDirs, screens,
  };
}

/** The facts as the model reads them. Nothing in them can close the README block early. */
export function factsText(f: RepoFacts): string {
  const line = (label: string, v: string | null) => (v ? [`${label}: ${v}`] : []);
  return [
    `Repository: ${f.repo}`,
    ...line("Package name", f.packageName),
    ...line("Package description", f.packageDescription),
    ...line("App name (app.json or app.config)", f.appName),
    ...line("Frameworks", f.frameworks.join(", ") || null),
    ...line("Top-level folders", f.topDirs.join(", ") || null),
    ...(f.screens.length ? ["Screen, page and route files:", ...f.screens.map((s) => `- ${s}`)] : []),
    ...(f.readme ? ["README (the start of it):", "<readme>", f.readme.replace(/<\/?readme>/gi, ""), "</readme>"] : []),
  ].join("\n");
}

/** "AI fashion app" -> "an AI fashion app": the prompts use the one-liner mid-sentence ("feedback about an AI fashion app"). */
function withArticle(s: string): string {
  const t = s.trim();
  if (!t || /^(a|an|the)\s/i.test(t)) return t;
  const word = /^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t; // "Fashion app" -> "fashion app"; "AI" stays
  return `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;
}

/** A first profile for the app, from its repository. Throws a plain sentence when the answer doesn't make one. */
export async function profileFromRepo(snap: RepoSnapshot, llm: StructuredCaller): Promise<ProductProfile> {
  const out = await llm({ system: PROFILE_FROM_REPO, user: factsText(repoFacts(snap)), schema: ProfileOut, effort: "low", maxTokens: 2000 });
  const profile = parseProfile({ ...out, one_liner: typeof out.one_liner === "string" ? withArticle(out.one_liner) : out.one_liner });
  if (!profile) throw new Error("PMA couldn't describe the product from the repository. Fill in the fields yourself.");
  return profile;
}

export type ProfileField = keyof ProductProfile;
const FIELD_MESSAGES: Record<ProfileField, string> = {
  name: "Give the product a name (up to 80 characters).",
  one_liner: "Say what it is in one line that starts with \"a\" or \"an\" (up to 240 characters).",
  audience: "Say who uses it, for example shoppers (up to 40 characters).",
  audience_one: "Say what one of them is called, for example shopper (up to 40 characters).",
  platform: "Pick web, mobile, or web and mobile.",
};

/**
 * A profile someone typed, checked field by field: the tidy profile, or a plain sentence for each field to fix. The
 * editor asks only for the name, the one-liner and the platform; audience words it doesn't send keep `keep`'s (the
 * saved profile's, drafted by Read my repository, else "people" and "person").
 */
export function profileEdit(v: unknown, keep: Pick<ProductProfile, "audience" | "audience_one"> = GENERIC_PROFILE): { ok: true; profile: ProductProfile } | { ok: false; fields: Partial<Record<ProfileField, string>> } {
  const sent = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  const o: Record<string, unknown> = { ...sent, audience: sent.audience === undefined ? keep.audience : sent.audience, audience_one: sent.audience_one === undefined ? keep.audience_one : sent.audience_one };
  // Each field on its own, so every one that needs fixing is named at once.
  const probe = { name: "x", one_liner: "a x", audience: "x", audience_one: "x", platform: "web" };
  const fields: Partial<Record<ProfileField, string>> = {};
  for (const k of Object.keys(FIELD_MESSAGES) as ProfileField[]) {
    if (!parseProfile({ ...probe, [k]: o[k] })) fields[k] = FIELD_MESSAGES[k];
  }
  if (!fields.one_liner && typeof o.one_liner === "string" && !/^(a|an)\s/i.test(o.one_liner.trim())) fields.one_liner = FIELD_MESSAGES.one_liner;
  if (Object.keys(fields).length) return { ok: false, fields };
  const profile = parseProfile(o);
  return profile ? { ok: true, profile } : { ok: false, fields: { platform: FIELD_MESSAGES.platform } };
}

export { PLATFORMS };
