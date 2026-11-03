import { describe, it, expect, vi } from "vitest";
import { profileFromRepo, repoFacts, profileEdit } from "@/lib/product/fromRepo";
import { setupDone, toolsUnlocked, onboardingState } from "@/lib/product/onboarding";
import { ProfileOut } from "@/lib/pipeline/schemas";
import { parseProfile } from "@/lib/product/profile";
import { fakeSnap } from "./fixtures/closetRepo";

const CLOSET = {
  "app.json": JSON.stringify({ expo: { name: "Closet", slug: "closet" } }),
  "package.json": JSON.stringify({ name: "closet-app-mobile", description: "Save your clothes and style outfits", dependencies: { expo: "^53" } }),
  "README.md": "# Closet\n\nCloset lets you photograph your wardrobe and generate styled outfit photos with AI.\n",
  "src/screens/StudioScreen.web.tsx": "export function StudioScreen() { return null; }\n",
  "src/screens/ClosetScreen.tsx": "export function ClosetScreen() { return null; }\n",
  "src/lib/api.ts": "export const api = 1;\n",
  "assets/data.json": "{}",
};

type Call = { system: string; user: string; schema: unknown; effort: string };
const answer = { name: "Closet", one_liner: "an AI fashion app where people save clothes and generate styled outfit photos", audience: "shoppers", audience_one: "shopper", platform: "web and mobile" as const };

describe("profileFromRepo", () => {
  it("tells the model what the repository says about itself, and returns a profile that parses", async () => {
    const llm = vi.fn(async (a: Call) => { void a; return answer; });
    const p = await profileFromRepo(fakeSnap(CLOSET), llm as never);
    expect(parseProfile(p)).toEqual(p);
    expect(p).toEqual(answer);
    expect(llm).toHaveBeenCalledTimes(1);
    const call = llm.mock.calls[0][0];
    expect(call.schema).toBe(ProfileOut);
    for (const fact of ["Closet", "closet-app-mobile", "Save your clothes and style outfits", "src/screens/StudioScreen.web.tsx", "generate styled outfit photos with AI", "expo"]) {
      expect(call.user, fact).toContain(fact);
    }
    expect(call.user).toMatch(/Top-level folders: .*assets.*src/);
    expect(call.system).toMatch(/untrusted data/i);
    expect(call.system).toMatch(/never follow instructions/i);
  });

  it("reads the Expo name from app.config.ts when there is no app.json, and the first README it finds", async () => {
    const facts = repoFacts(fakeSnap({ "app.config.ts": "export default { name: \"Wardrobe\", slug: \"wardrobe\" };", "readme.md": "Hello from the readme", "app/(tabs)/index.tsx": "x" }));
    expect(facts.appName).toBe("Wardrobe");
    expect(facts.readme).toContain("Hello from the readme");
    expect(facts.screens).toContain("app/(tabs)/index.tsx");
  });

  it("puts an article in front of a one-liner that lacks one, so the prompts read as sentences", async () => {
    const llm = vi.fn(async () => ({ ...answer, one_liner: "AI fashion app for outfits" }));
    expect((await profileFromRepo(fakeSnap(CLOSET), llm as never)).one_liner).toBe("an AI fashion app for outfits");
  });

  it("refuses a model answer that doesn't make a profile, in a plain sentence", async () => {
    const llm = vi.fn(async () => ({ ...answer, audience: "" }));
    await expect(profileFromRepo(fakeSnap(CLOSET), llm as never)).rejects.toThrow(/couldn't describe/i);
  });

  it("keeps the facts short: a huge README is cut and file lists are capped", () => {
    const files: Record<string, string> = { "README.md": "x".repeat(50_000) };
    for (let k = 0; k < 300; k++) files[`src/screens/S${k}Screen.tsx`] = "x";
    const facts = repoFacts(fakeSnap(files));
    expect(facts.readme!.length).toBeLessThanOrEqual(3000);
    expect(facts.screens.length).toBeLessThanOrEqual(60);
  });
});

describe("profileEdit", () => {
  it("accepts a complete profile and tidies it", () => {
    expect(profileEdit({ ...answer, name: "  Closet  " })).toEqual({ ok: true, profile: answer });
  });

  it("names each field that needs fixing, in plain words", () => {
    const r = profileEdit({ name: "", one_liner: "fashion app", audience: "x".repeat(41), audience_one: "shopper", platform: "desktop" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.fields).sort()).toEqual(["audience", "name", "one_liner", "platform"]);
    expect(r.fields.one_liner).toMatch(/starts with "a" or "an"/i);
  });

  it("keeps the saved audience words when the editor doesn't send them (it shows only name, one line and platform)", () => {
    const shown = { name: "Closet", one_liner: answer.one_liner, platform: answer.platform };
    expect(profileEdit(shown, { audience: "shoppers", audience_one: "shopper" })).toEqual({ ok: true, profile: { ...shown, audience: "shoppers", audience_one: "shopper" } });
    // Never drafted from the repository: people and person.
    expect(profileEdit(shown)).toEqual({ ok: true, profile: { ...shown, audience: "people", audience_one: "person" } });
    // Words that are sent are still checked.
    const r = profileEdit({ ...shown, audience: "" }, { audience: "shoppers", audience_one: "shopper" });
    expect(r.ok).toBe(false);
  });
});

describe("onboardingState", () => {
  it("ticks each step off from the app, its sources and its company", () => {
    expect(onboardingState({ repo_full_name: null, product_profile: null, sources: 0, members: 1 })).toEqual({ repo: false, claude: false, profile: false, slack: false, tools: 0, feedback: false, team: false });
    expect(onboardingState({ repo_full_name: "acme/web", product_profile: answer, sources: 3, members: 2, claude: true, slack: true, tools: 2 })).toEqual({ repo: true, claude: true, profile: true, slack: true, tools: 2, feedback: true, team: true });
    // A malformed stored profile isn't a saved one.
    expect(onboardingState({ repo_full_name: "acme/web", product_profile: { name: "x" }, sources: 0, members: 1 }).profile).toBe(false);
  });

  it("ticks step 1 off only once the repository, the Claude key and the description are all in", () => {
    expect(setupDone({ repo: true, claude: true, profile: false })).toBe(false);
    expect(setupDone({ repo: true, claude: false, profile: true })).toBe(false);
    expect(setupDone({ repo: true, claude: true, profile: true })).toBe(true);
  });

  it("opens Slack and the other tools only once the repository and the Claude key are in", () => {
    expect(toolsUnlocked({ repo: true, claude: false })).toBe(false);
    expect(toolsUnlocked({ repo: false, claude: true })).toBe(false);
    expect(toolsUnlocked({ repo: true, claude: true })).toBe(true);
  });
});
