// Start here's checklist for a customer app: which setup steps are done. Pure: the welcome page counts the app's
// sources and the company's members and passes them in.
import { parseProfile, type ProfileSource } from "./profile";

export type OnboardingState = { repo: boolean; claude: boolean; profile: boolean; slack: boolean; tools: number; feedback: boolean; team: boolean };

/**
 * Connected a repository; added the company's Claude key (required); saved a product profile; has its Slack channels
 * (optional); how many more tools are connected (Marver, PostHog, Granola; optional); has at least one piece of
 * feedback; has a teammate (optional).
 */
export function onboardingState(app: { repo_full_name: string | null; product_profile: unknown; sources: number; members: number; claude?: boolean; slack?: boolean; tools?: number }): OnboardingState {
  return {
    repo: !!app.repo_full_name,
    claude: !!app.claude,
    profile: parseProfile(app.product_profile) !== null,
    slack: !!app.slack,
    tools: app.tools ?? 0,
    feedback: app.sources > 0,
    team: app.members >= 2,
  };
}

/** Step 1 is done once the repository, the Claude key and the product description are all in. */
export const setupDone = (s: Pick<OnboardingState, "repo" | "claude" | "profile">) => s.repo && s.claude && s.profile;

/** Slack and the other tools open once the code and the key are in: Slack cards and mock-ups need both to be useful. */
export const toolsUnlocked = (s: Pick<OnboardingState, "repo" | "claude">) => s.repo && s.claude;

/** Start here's screens, one thing to do on each, in the order they're walked. */
export type SetupStepKey = "intro" | "claude" | "github" | "product" | "slack" | "sentry" | "posthog" | "granola" | "marver" | "feedback" | "team" | "done";
export type SetupSection = "Basics" | "Connect your tools" | "Get going";
export type SetupStep = { key: SetupStepKey; label: string; section: SetupSection; optional: boolean; done: boolean };
export type SetupTools = Partial<Record<"sentry" | "posthog" | "granola" | "marver", boolean>>;

/**
 * The steps for an app, grouped in the order the work depends on. Basics: the repository (PMA reads the code), the
 * Claude key (everything runs on it), then the product description (drafted from that code, which needs both). Connect your tools, one per
 * screen and all optional: Slack (feedback in, issue cards out), Sentry (crashes and user feedback), PostHog (errors
 * and rage clicks, so urgency counts real people), Granola (call notes), Marver (the design canvas mock-ups are drawn
 * on). Get going: the first feedback (already done when a tool brought some in), the team, and the tour. The demo's
 * key, repository, description and tools are PMA's, so it walks the welcome, how feedback is sorted, joining Slack and
 * the tour. Welcome counts as done once anything else is.
 */
export function setupSteps(s: OnboardingState, opts: { demo?: boolean; tools?: SetupTools } = {}): SetupStep[] {
  const t = opts.tools ?? {};
  const started = s.claude || s.repo || s.profile || s.feedback;
  if (opts.demo) {
    return [
      { key: "intro", label: "Welcome", section: "Basics", optional: false, done: true },
      { key: "feedback", label: "Feedback", section: "Get going", optional: false, done: s.feedback },
      { key: "slack", label: "Slack", section: "Connect your tools", optional: true, done: false },
      { key: "done", label: "Tour", section: "Get going", optional: false, done: false },
    ];
  }
  return [
    { key: "intro", label: "Welcome", section: "Basics", optional: false, done: started },
    { key: "github", label: "Repository", section: "Basics", optional: false, done: s.repo },
    { key: "claude", label: "Claude", section: "Basics", optional: false, done: s.claude },
    { key: "product", label: "Product", section: "Basics", optional: false, done: s.profile },
    { key: "slack", label: "Slack", section: "Connect your tools", optional: true, done: s.slack },
    { key: "sentry", label: "Sentry", section: "Connect your tools", optional: true, done: !!t.sentry },
    { key: "posthog", label: "PostHog", section: "Connect your tools", optional: true, done: !!t.posthog },
    { key: "granola", label: "Granola", section: "Connect your tools", optional: true, done: !!t.granola },
    { key: "marver", label: "Marver", section: "Connect your tools", optional: true, done: !!t.marver },
    { key: "feedback", label: "Feedback", section: "Get going", optional: false, done: s.feedback },
    { key: "team", label: "Team", section: "Get going", optional: true, done: s.team },
    { key: "done", label: "Done", section: "Get going", optional: false, done: false },
  ];
}

/** The step named in the URL, when it's one of this app's. */
export function stepFrom(v: unknown, steps: SetupStep[]): SetupStepKey | null {
  return typeof v === "string" && steps.some((s) => s.key === v) ? (v as SetupStepKey) : null;
}

/**
 * Where Start here opens with no step in the URL: the tour's page for a first sign-in into an app that already has
 * issues; the welcome for the demo or an app nobody has started; otherwise the first required step still to do, and
 * the last page once they're all done.
 */
export function startStep(steps: SetupStep[], opts: { demo?: boolean; tour?: boolean; hasIssues?: boolean } = {}): SetupStepKey {
  if (opts.tour && opts.hasIssues) return "done";
  if (opts.demo) return "intro";
  const open = steps.find((s) => s.key !== "done" && !s.optional && !s.done);
  return open?.key ?? "done";
}

/** The steps either side of this one (null at the ends). */
export function neighbours(steps: SetupStep[], key: SetupStepKey): { prev: SetupStep | null; next: SetupStep | null; index: number } {
  const index = Math.max(0, steps.findIndex((s) => s.key === key));
  return { prev: steps[index - 1] ?? null, next: steps[index + 1] ?? null, index };
}

/** Whose feedback the Desk sorts: the demo's "Member feedback", a described app's "Feedback from shoppers", else "Feedback". */
export function deskFeedbackFrom(project: ProfileSource): string {
  if (project.kind === "demo") return "Member feedback";
  const p = parseProfile(project.product_profile);
  return p ? `Feedback from ${p.audience}` : "Feedback";
}
