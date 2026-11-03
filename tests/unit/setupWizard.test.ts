// Start here, one step per screen: the steps' order (basics, then a screen per tool, then feedback, team and the tour),
// where it opens, the tools waiting on the Claude key and repository, what each screen says once its connector is in,
// and a repository name that ends in "." never getting a second full stop.
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/components/app/AppContext", () => ({ useApp: () => ({ api: (p: string) => `/api/apps/x${p}`, appId: "x" }) }));

import { neighbours, setupSteps, startStep, stepFrom, type OnboardingState } from "@/lib/product/onboarding";
import { stepContent, type StepContext } from "@/components/onboarding/SetupSteps";
import { SetupRail, StepFrame } from "@/components/onboarding/SetupWizard";

const fresh: OnboardingState = { repo: false, claude: false, profile: false, slack: false, tools: 0, feedback: false, team: false };
const off = (tool: string) => ({ tool, state: "off", reason: null });
const cards = [
  { ...off("claude"), last4: null, sharedFallback: false },
  { ...off("slack"), offered: true, reachable: false, team: null, channels: [], needsChannels: false, prefix: "closet", error: null },
  { ...off("marver"), repo: null, path: null, screens: null, flows: null, appRepo: "acme/Closet." },
  { ...off("posthog"), region: null, project: null, auth: null, pick: null, lastSync: null },
  { ...off("sentry"), org: null, project: null, selfHosted: false, pick: null, lastSync: null },
  { ...off("granola"), last4: null, webhook: false, here: true, target: null, lastSync: null },
] as never[];

function ctx(state: OnboardingState, over: Partial<StepContext> = {}): StepContext {
  const steps = setupSteps(state);
  return {
    state, steps, path: "/acme/app/welcome", base: "/acme/app", href: (p) => `/acme/app${p}`, membersHref: "/acme/settings/members",
    canEdit: true, appName: "Closet", companyName: "Acme", who: "what people say about Closet", repo: state.repo ? "acme/Closet." : null, branch: null,
    profile: null, sources: 0, members: 1, widgetSnippet: "<script></script>", apiUrl: "http://x/api/v1/feedback",
    cards, flash: null, github: null, githubFlash: null, demo: null, tour: null, ...over,
  };
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const screen = (key: Parameters<typeof stepContent>[0], c: StepContext) =>
  text(renderToStaticMarkup(createElement(StepFrame, { steps: c.steps, current: key, path: c.path, ...stepContent(key, c) })));

describe("setupSteps", () => {
  it("walks the basics, then one screen per tool, then feedback, the team and the tour", () => {
    expect(setupSteps(fresh).map((s) => s.key)).toEqual(["intro", "github", "claude", "product", "slack", "sentry", "posthog", "granola", "marver", "feedback", "team", "done"]);
    expect(setupSteps(fresh).filter((s) => s.optional).map((s) => s.key)).toEqual(["slack", "sentry", "posthog", "granola", "marver", "team"]);
  });

  it("gives the demo the welcome, how feedback is sorted, joining Slack and the tour", () => {
    expect(setupSteps(fresh, { demo: true }).map((s) => s.key)).toEqual(["intro", "feedback", "slack", "done"]);
  });

  it("ticks each tool's screen from its own connection", () => {
    const steps = setupSteps({ ...fresh, tools: 1 }, { tools: { sentry: true } });
    expect(steps.find((s) => s.key === "sentry")?.done).toBe(true);
    expect(steps.find((s) => s.key === "posthog")?.done).toBe(false);
  });
});

describe("startStep", () => {
  it("opens on the welcome for a new app, then on the first required step still to do", () => {
    expect(startStep(setupSteps(fresh))).toBe("intro");
    expect(startStep(setupSteps({ ...fresh, claude: true }))).toBe("github");
    expect(startStep(setupSteps({ ...fresh, repo: true }))).toBe("claude");
    expect(startStep(setupSteps({ ...fresh, claude: true, repo: true }))).toBe("product");
    // Optional tools are never where it opens: with the basics in, the next required thing is the first feedback.
    expect(startStep(setupSteps({ ...fresh, claude: true, repo: true, profile: true }))).toBe("feedback");
    expect(startStep(setupSteps({ ...fresh, claude: true, repo: true, profile: true, feedback: true }))).toBe("done");
  });

  it("opens the tour's step for a first sign-in once there are issues, and the welcome for the demo", () => {
    expect(startStep(setupSteps(fresh), { tour: true, hasIssues: true })).toBe("done");
    expect(startStep(setupSteps(fresh), { tour: true, hasIssues: false })).toBe("intro");
    expect(startStep(setupSteps(fresh, { demo: true }), { demo: true })).toBe("intro");
  });

  it("takes a step from the URL only when it's one of this app's", () => {
    expect(stepFrom("sentry", setupSteps(fresh))).toBe("sentry");
    expect(stepFrom("sentry", setupSteps(fresh, { demo: true }))).toBeNull();
    expect(stepFrom("../settings", setupSteps(fresh))).toBeNull();
  });

  it("knows the steps either side", () => {
    const n = neighbours(setupSteps(fresh), "slack");
    expect([n.prev?.key, n.next?.key, n.index]).toEqual(["product", "sentry", 4]);
    expect(neighbours(setupSteps(fresh), "intro").prev).toBeNull();
    expect(neighbours(setupSteps(fresh), "done").next).toBeNull();
  });
});

describe("the screens", () => {
  it("says where each step sits, and offers to skip what's optional or leave a basic for later", () => {
    const c = ctx(fresh);
    expect(screen("sentry", c)).toContain("Step 6 of 12 · Connect your tools · Optional");
    expect(screen("sentry", c)).toContain("Skip for now");
    expect(screen("claude", c)).toContain("Do this later");
    expect(screen("intro", c)).toContain("Start setup");
  });

  it("keeps Slack and the tools waiting on the Claude key and the repository, with a way to each", () => {
    const t = screen("sentry", ctx(fresh));
    expect(t).toContain("This opens once your repository and Claude key are in.");
    expect(t).toMatch(/Go to Repository.*Go to Claude/);
    expect(screen("sentry", ctx({ ...fresh, claude: true, repo: true }))).not.toContain("This opens once");
  });

  it("says what's true once a connector is in, and Continue takes over from Skip", () => {
    const state = { ...fresh, claude: true, repo: true };
    const t = screen("github", ctx(state, { branch: "main" }));
    expect(t).toContain("Connected to acme/Closet. on main");
    expect(t).not.toMatch(/Closet\.\./);
    expect(t).toContain("Continue");
    expect(t).not.toContain("Do this later");
  });

  it("lists every step on the last screen, ticked or still to do", () => {
    const t = screen("done", ctx({ ...fresh, claude: true }));
    expect(t).toContain("Almost there");
    expect(t).toMatch(/Claude Done/);
    expect(t).toMatch(/Repository To do/);
    expect(t).toMatch(/Sentry Optional/);
    expect(t).toContain("Go to the Desk");
  });

  it("rings the step you're on in the rail", () => {
    const html = renderToStaticMarkup(createElement(SetupRail, { steps: setupSteps(fresh), current: "github", path: "/acme/app/welcome" }));
    expect(html).toMatch(/<a aria-current="step"[^>]*href="\/acme\/app\/welcome\?step=github"/);
    // Once in the phone bar and once among the dots; only one shows at a time.
    expect((html.match(/aria-current="step"/g) ?? []).length).toBe(2);
    expect(html).not.toMatch(/aria-current="step"[^>]*href="\/acme\/app\/welcome\?step=claude"/);
  });
});
