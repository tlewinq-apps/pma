import { ViewTransition } from "react";
import { requireApp } from "@/lib/db/app";
import { appHref } from "@/lib/links";
import { listIssues } from "@/lib/queries/issues";
import { slackEnabled } from "@/lib/env";
import { slackStatus } from "@/lib/slack/setup";
import { slackInviteFor, slackIsMine } from "@/lib/slack/ownership";
import { tourIssue } from "@/components/triage/views";
import { PageTransition } from "@/components/app/PageTransition";
import { SetupRail, StepFrame } from "@/components/onboarding/SetupWizard";
import { stepContent, type DemoSlack } from "@/components/onboarding/SetupSteps";
import { onboardingState, setupSteps, startStep, stepFrom } from "@/lib/product/onboarding";
import { parseProfile } from "@/lib/product/profile";
import { userDb } from "@/lib/db/server";
import { env } from "@/lib/env";
import { toolCards, type ToolCard } from "@/lib/connections/view";
import { flashFrom } from "@/components/connections/flash";
import { githubFlashFrom } from "@/components/github/flash";
import { githubView, type GithubView } from "@/lib/github/view";

// Steps slide the way you're going: Continue and later dots move forward, Back and earlier dots move back.
const MOVES = { "nav-forward": "page-forward", "nav-back": "page-back", default: "none" };

/**
 * Start here, one step per screen (?step=<key>): the basics (repository, Claude key, product description), each tool
 * on its own screen (Slack, Sentry, PostHog, Granola, Marver), then the first feedback, the team and the tour. With no
 * step in the URL it opens on the first required step still to do. The demo app's repository, description, key and
 * tools are PMA's, so it walks the welcome, how feedback is sorted, joining the deployment's Slack and the tour. New
 * members land here after their first sign-in with ?tour=1, which opens the tour's step once there's an issue.
 */
export default async function WelcomePage(props: PageProps<"/[org]/[app]/welcome">) {
  const { org: orgSlug, app } = await props.params;
  const sp = await props.searchParams;
  const ctx = await requireApp(orgSlug, app);
  const { project, org, base, role, email } = ctx;
  const demo = project.kind === "demo";
  const db = await userDb();
  const [issues, sources, members] = await Promise.all([
    listIssues(project.id),
    db.from("sources").select("id", { count: "exact", head: true }).eq("project_id", project.id),
    db.from("org_members").select("user_id", { count: "exact", head: true }).eq("org_id", org.id),
  ]);
  const sourceCount = sources.count ?? 0, memberCount = members.count ?? 1;
  const profile = parseProfile(project.product_profile);

  // The demo's Slack is the deployment's own workspace: Join Slack with its shared invite, and its channels there. Its
  // repository, description and Claude key are PMA's, and Settings gives it no Connect cards, so neither does this.
  let cards: ToolCard[] = [], demoSlack: DemoSlack | null = null, slack: boolean, claude: boolean, github: GithubView | null = null;
  const tools = { sentry: false, posthog: false, granola: false, marver: false };
  if (demo) {
    const mine = await slackIsMine(project.id);
    const [status, invite] = await Promise.all([
      mine && slackEnabled() ? slackStatus(project.id) : Promise.resolve(null),
      mine ? slackInviteFor(project.id) : Promise.resolve(null),
    ]);
    demoSlack = { invite, email: email || null, channels: status?.channels ?? [] };
    slack = mine;
    claude = true;
  } else {
    [cards, github] = await Promise.all([toolCards(project), githubView(org.id)]);
    const connected = (tool: string) => cards.some((c) => c.tool === tool && c.state === "connected");
    slack = connected("slack");
    claude = connected("claude");
    for (const t of Object.keys(tools) as (keyof typeof tools)[]) tools[t] = connected(t);
  }
  const counted = onboardingState({
    repo_full_name: project.repo_full_name, product_profile: project.product_profile, sources: sourceCount, members: memberCount,
    claude, slack, tools: Object.values(tools).filter(Boolean).length,
  });
  const state = demo ? { ...counted, repo: true, profile: true } : counted;
  const steps = setupSteps(state, { demo, tools });
  const current = stepFrom(sp.step, steps) ?? startStep(steps, { demo, tour: sp.tour === "1", hasIssues: issues.length > 0 });
  const path = `${base}/welcome`;
  const first = tourIssue(issues);
  const appUrl = env.appUrl();

  const content = stepContent(current, {
    state, steps, path, base, href: (p) => appHref(base, p), membersHref: `/${org.slug}/settings/members`,
    canEdit: role === "owner" || role === "admin", appName: project.name, companyName: org.name,
    who: profile ? `what ${profile.audience} say about ${profile.name}` : "what people say about your product",
    repo: project.repo_full_name, branch: project.repo_full_name ? project.watched_branch || null : null, profile,
    sources: sourceCount, members: memberCount,
    widgetSnippet: `<script src="${appUrl}/widget.js" data-project="${project.widget_key}" async></script>`, apiUrl: `${appUrl}/api/v1/feedback`,
    cards, flash: flashFrom(sp), github, githubFlash: githubFlashFrom(sp), demo: demoSlack,
    // The tour needs an issue to walk through, so a new app's first sign-in doesn't start it until feedback comes in.
    tour: first ? { id: first.id, title: first.title, type: first.type, auto: sp.tour === "1" && issues.length > 0 } : null,
  });

  return (
    <PageTransition><div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <p className="mb-5 text-sm text-muted-foreground">Start here · Set up {project.name}</p>
      <SetupRail steps={steps} current={current} path={path} />
      <ViewTransition key={current} enter={MOVES} exit={MOVES} default="none">
        <StepFrame steps={steps} current={current} path={path} {...content} />
      </ViewTransition>
    </div></PageTransition>
  );
}
