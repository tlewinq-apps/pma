// What an app is, in its own words: the product profile (projects.product_profile, migration 0022) that every prompt
// and the audience words on screen are written from. The demo app (kind 'demo') is always Celeste, the sample
// astrology app; any other app reads its stored profile, or a generic one until it has one. Pure and dependency-free:
// shared by the pipeline (server) and the analysis panels (client).

export const PLATFORMS = ["web", "mobile", "web and mobile"] as const;
export type ProductProfile = { name: string; one_liner: string; audience: string; audience_one: string; platform: (typeof PLATFORMS)[number] };

export const DEMO_PROFILE: ProductProfile = Object.freeze({ name: "Celeste", one_liner: "an astrology app with daily horoscopes, birth charts and compatibility readings", audience: "members", audience_one: "member", platform: "mobile" });
/** Until an app is described. Its audience words are "people" and "person": the editor doesn't ask for them, so an app
 *  whose profile was never drafted from its repository keeps these. */
export const GENERIC_PROFILE: ProductProfile = Object.freeze({ name: "this app", one_liner: "a software product", audience: "people", audience_one: "person", platform: "web" });

/** The profile goes into system prompts, so each field is short, single-line text. A trailing full stop is dropped (it sits mid-sentence). */
function words(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "").trim();
  return s && s.length <= max ? s : null;
}

/** A stored profile, or null when it is missing or malformed. Unknown keys are dropped. */
export function parseProfile(v: unknown): ProductProfile | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const name = words(o.name, 80), one_liner = words(o.one_liner, 240), audience = words(o.audience, 40), audience_one = words(o.audience_one, 40);
  const platform = PLATFORMS.find((x) => x === o.platform);
  return name && one_liner && audience && audience_one && platform ? { name, one_liner, audience, audience_one, platform } : null;
}

export type ProfileSource = { kind: string; product_profile: unknown; name: string };

/** The demo app is always Celeste; any other app its stored profile, or the generic one named after the app. */
export function profileOf(project: ProfileSource): ProductProfile {
  if (project.kind === "demo") return DEMO_PROFILE;
  return parseProfile(project.product_profile) ?? { ...GENERIC_PROFILE, name: project.name };
}

/** Whether this is the demo app's profile: it has no repository, so its first steps are simulated and its proposals come from its built-in canvas. */
export function isDemoProfile(p: ProductProfile): boolean {
  return (Object.keys(DEMO_PROFILE) as (keyof ProductProfile)[]).every((k) => p[k] === DEMO_PROFILE[k]);
}

/** Who a piece of feedback came from, as the classifier tags it ("unknown" is added by classifyOutFor). The same for every app, the demo included. */
export const CUSTOMER_AUDIENCES = ["users", "staff", "leadership"] as const;
export const DEMO_AUDIENCES = CUSTOMER_AUDIENCES;

/** What the prompts need to know about an app: its profile and its audiences, built together so they can't disagree. */
export type AppProduct = { profile: ProductProfile; audiences: readonly string[] };
export function productOf(project: ProfileSource): AppProduct {
  return { profile: profileOf(project), audiences: CUSTOMER_AUDIENCES };
}
/** The demo app's, for callers whose data is the Celeste set (the eval, tests). */
export const DEMO_PRODUCT: AppProduct = Object.freeze({ profile: DEMO_PROFILE, audiences: DEMO_AUDIENCES });

/**
 * profileOf for a project embedded in another row (issues -> projects): a clear error, not a TypeError, when the
 * embed did not load, so no prompt is ever written without knowing the app.
 */
export function profileOfEmbedded(project: ProfileSource | null | undefined, where: string): ProductProfile {
  if (!project || typeof project !== "object" || typeof project.kind !== "string") {
    throw new Error(`${where}: the issue's app did not load, so its product profile is unknown`);
  }
  return profileOf(project);
}

/** The roles a recording's speakers can have: the app's one user ("member", "shopper"), its own staff, or other. */
export function speakerRolesFor(p: ProductProfile): string[] {
  return [...new Set([p.audience_one, "staff", "other"])];
}
