// What each Start here screen says and holds: its title and lead, what's true once it's done, and its body (the Connect
// card for its tool, the repository picker, the product description, the ways to send feedback, the tour). Server
// component; the cards and forms inside are the same ones Settings uses. The demo app's key, repository, description
// and tools are PMA's, so its screens are the welcome, how feedback is sorted, joining Slack and the tour.
import Link from "next/link";
import { ArrowRight, Check, ExternalLink, Lock, MessageSquareText, Rocket, Stethoscope } from "lucide-react";
import { CopyLink } from "@/components/invite/CopyLink";
import { ProfileEditor } from "./ProfileEditor";
import { ToolCards, type Flash } from "@/components/connections/ToolCards";
import { GithubConnect } from "@/components/github/GithubConnect";
import type { GithubFlash } from "@/components/github/flash";
import type { GithubView } from "@/lib/github/view";
import type { ToolCard, ToolKey } from "@/lib/connections/view";
import type { SlackStatus } from "@/lib/slack/setup";
import type { ProductProfile } from "@/lib/product/profile";
import type { IssueType } from "@/lib/types";
import { CHECKS } from "@/lib/diagnosis/checks";
import { RAIL_LABEL, RAIL_ORDER } from "@/components/triage/format";
import { TourStart } from "@/components/app/TourStart";
import { setupDone, toolsUnlocked, type OnboardingState, type SetupStep, type SetupStepKey } from "@/lib/product/onboarding";
import type { StepFrameProps } from "./SetupWizard";

export const COMING_NEXT = [
  "A Marver canvas created from your real components, with full-fidelity screens.",
];

/** What each type's first step finds, in a few words. */
const FINDS: Record<IssueType, string> = {
  bug: "finds the cause",
  new_feature: "shows who wants it and the smallest useful version",
  add_on: "shows which screen it extends",
  streamline: "shows where people stall",
};

/** The demo app's Slack: the deployment workspace's invite link, the email to join with, and the app's channels there. */
export type DemoSlack = { invite: string | null; email: string | null; channels: SlackStatus["channels"] };

export type StepContext = {
  state: OnboardingState; steps: SetupStep[]; path: string; base: string; href: (path: string) => string; membersHref: string;
  canEdit: boolean; appName: string; companyName: string; who: string; repo: string | null; branch: string | null; profile: ProductProfile | null;
  sources: number; members: number; widgetSnippet: string; apiUrl: string;
  cards: ToolCard[]; flash: Flash; github: GithubView | null; githubFlash: GithubFlash; demo: DemoSlack | null;
  tour: { id: string; title: string; type: IssueType; auto: boolean } | null;
};

type Content = Omit<StepFrameProps, "steps" | "current" | "path">;

const action = "inline-flex h-10 items-center gap-2 btn-ink sheen px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60";
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Where a step's OAuth hand-off (Add to Slack, Connect with GitHub, PostHog) comes back to: this same step. */
const back = (c: StepContext, key: SetupStepKey) => `${c.path}?step=${key}`;

/** The card for one tool, or what it waits on: Slack and the tools need the repository and the Claude key first. */
function ToolStep({ c, tool }: { c: StepContext; tool: ToolKey }) {
  if (!toolsUnlocked(c.state)) return <Waiting c={c} />;
  return <ToolCards cards={c.cards} canEdit={c.canEdit} returnTo={back(c, tool as SetupStepKey)} flash={c.flash?.tool === tool ? c.flash : null} only={[tool]} />;
}

function Waiting({ c }: { c: StepContext }) {
  const missing = c.steps.filter((s) => (s.key === "github" || s.key === "claude") && !s.done);
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
      <Lock aria-hidden className="size-4" />This opens once your repository and Claude key are in.
      {missing.map((s) => <Link key={s.key} href={`${c.path}?step=${s.key}`} transitionTypes={["nav-back"]} className="link text-foreground">Go to {s.label}</Link>)}
    </p>
  );
}

const card = <T extends ToolKey>(c: StepContext, tool: T) => c.cards.find((x) => x.tool === tool) as Extract<ToolCard, { tool: T }> | undefined;

export function stepContent(key: SetupStepKey, c: StepContext): Content {
  const step = c.steps.find((s) => s.key === key)!;
  const done = step.done;
  switch (key) {
    case "intro": return {
      title: "Welcome to PMA", done, nextLabel: c.demo || done ? "Continue" : "Start setup",
      lead: c.demo
        ? <>PMA turns what Celeste&apos;s members say into shipped fixes. The demo is set up already: walk through how feedback is sorted, join its Slack, then take the tour.</>
        : <>PMA turns {c.who} into shipped fixes. These steps set up {c.appName}: your repository and Claude key, then the tools your team already uses, then your first feedback. About five minutes; anything optional can wait for Settings.</>,
      children: (
        <ol className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: MessageSquareText, title: "Collect", text: "Calls, Slack, Sentry and your in-app widget become issues, most urgent first." },
            { icon: Stethoscope, title: "Diagnose", text: "Claude reads your code, finds the cause and cites the lines." },
            { icon: Rocket, title: "Ship", text: "Approve a mock-up, and Build it opens the pull request." },
          ].map((b, i) => (
            <li key={b.title} className="rise-in rounded-xl bg-card p-4 shadow-[0_0_0_1px_var(--border)]" style={{ animationDelay: `${260 + i * 120}ms` }}>
              <b.icon aria-hidden className="size-5 text-primary" />
              <p className="mt-3 font-heading text-lg font-semibold text-foreground">{b.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{b.text}</p>
            </li>
          ))}
        </ol>
      ),
    };

    case "claude": {
      const cl = card(c, "claude");
      return {
        title: "Add your Claude key", done, doneText: cl?.last4 ? `Using your key ending in ${cl.last4}` : "Your Claude key is in",
        lead: <>PMA runs on Claude with your company&apos;s own API key: it reads your feedback and your code, and writes the proposals. Usage is billed to your company, and PMA never spends anyone else&apos;s key.</>,
        children: (
          <>
            <ToolCards cards={c.cards} canEdit={c.canEdit} returnTo={back(c, "claude")} flash={null} only={["claude"]} />
            {!done && <p className="mt-4 text-sm text-muted-foreground">No key yet? Make one in the <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1">Claude Console<ExternalLink aria-hidden className="size-3.5" /></a>.</p>}
          </>
        ),
      };
    }

    case "github": return {
      title: "Connect your repository", done, celebrate: !!c.githubFlash?.ok, doneText: c.repo ? `Connected to ${c.repo}${c.branch ? ` on ${c.branch}` : ""}` : null,
      lead: <>PMA reads your code to find where feedback points, and cites the file and line it rests on. It reads only the repository you pick.</>,
      children: c.repo ? (
        // A repository name can end in "." (acme/Closet.), so no full stop follows it directly.
        <p>Each first step reads the code in <code className="text-foreground">{c.repo}</code> and cites the lines it rests on. <Link href={c.href("/settings#repository")} className="link">Change it in Settings</Link>.</p>
      ) : !c.canEdit ? (
        <p className="text-muted-foreground">A company owner or admin connects it.</p>
      ) : c.github?.enabled ? (
        <div className="space-y-3">
          <GithubConnect github={c.github} canEdit={c.canEdit} returnTo={back(c, "github")} flash={c.githubFlash} />
          <p className="text-sm text-muted-foreground">Or <Link href={c.href("/settings#repository")} className="link">connect a public repository by name</Link>.</p>
        </div>
      ) : <Link href={c.href("/settings#repository")} className={action}>Connect your repository</Link>,
    };

    case "product": return {
      title: "Describe your product", done, doneText: c.profile ? `${c.profile.name}, ${c.profile.one_liner}` : null,
      lead: <>PMA writes about your feedback in your product&apos;s own words: its name, what it is and where it&apos;s used. Read my repository drafts it from your code; change anything that&apos;s off.</>,
      children: <ProfileEditor initial={c.profile} appName={c.appName} canEdit={c.canEdit} hasRepo={c.state.repo} />,
    };

    case "slack": {
      if (c.demo) return {
        title: "Join the Slack workspace", done: false,
        lead: <>Most of the work happens in Slack. Every issue gets a card, and the card&apos;s thread is where you pick a fix and approve it.</>,
        children: <DemoSlackStep slack={c.demo} />,
      };
      const sl = card(c, "slack");
      return {
        title: "Bring PMA into Slack", done, celebrate: c.flash?.tool === "slack" && c.flash.ok, doneText: sl?.team ? `Connected to the ${sl.team} workspace` : "Slack is connected",
        lead: <>Post feedback in one channel and PMA files it; every issue gets a card in another, where your team takes it on and approves the fix. PMA adds itself to your own workspace and makes the two channels for {c.appName}.</>,
        children: <ToolStep c={c} tool="slack" />,
      };
    }

    case "sentry": {
      const se = card(c, "sentry");
      return {
        title: "Connect Sentry", done, doneText: se?.project ? `Reading ${se.org ? `${se.org}/` : ""}${se.project}` : "Sentry is connected",
        lead: <>Crash reports, and what people send through Sentry&apos;s User Feedback. PMA links errors to issues, and how many people each one hit counts toward urgency.</>,
        children: <ToolStep c={c} tool="sentry" />,
      };
    }

    case "posthog": {
      const ph = card(c, "posthog");
      return {
        title: "Connect PostHog", done, celebrate: c.flash?.tool === "posthog" && c.flash.ok, doneText: ph?.project ? `Reading ${ph.project}` : "PostHog is connected",
        lead: <>Errors and rage clicks from your product analytics. Linked to an issue, they show how many people really hit it.</>,
        children: <ToolStep c={c} tool="posthog" />,
      };
    }

    case "granola": return {
      title: "Connect Granola", done, doneText: "Granola is connected",
      lead: <>Notes from your customer calls. Each new note is read as feedback, so what people said on a call lands on the Desk.</>,
      children: <ToolStep c={c} tool="granola" />,
    };

    case "marver": {
      const mv = card(c, "marver");
      return {
        title: "Connect Marver", done, doneText: mv?.repo ? `Mock-ups draw on ${mv.repo}` : "Marver is connected",
        lead: <>Your design canvas. With it, mock-ups are drawn on your real screens; without it, PMA draws an approximate one from your code.</>,
        children: <ToolStep c={c} tool="marver" />,
      };
    }

    case "feedback": return {
      title: c.demo ? "How PMA sorts feedback" : "Send in your first feedback", done,
      doneText: c.sources ? `${plural(c.sources, "piece", "pieces")} of feedback in so far` : null,
      lead: <>PMA splits feedback into single problems and files each one by type. Before anyone proposes a change, it looks into it, and how depends on the type.</>,
      children: <FeedbackStep c={c} />,
    };

    case "team": return {
      title: "Bring in your team", done, doneText: `${plural(c.members, "person is", "people are")} in ${c.companyName}`,
      lead: <>Feedback gets acted on when product, design and engineering look at the same issues. Invite the people who&apos;ll pick the fixes and ship them.</>,
      children: <Link href={c.membersHref} className={action}>{c.state.team ? "See company members" : "Invite your team"}<ArrowRight aria-hidden className="size-4" /></Link>,
    };

    case "done": {
      const ready = c.demo || (setupDone(c.state) && c.state.feedback);
      return {
        title: c.demo ? "Take the tour" : ready ? "You're set up" : "Almost there", done: false, finish: { label: "Go to the Desk", href: c.base },
        lead: c.tour
          ? <>Walk one real issue, &ldquo;{c.tour.title}&rdquo;, from what someone said to a fix{c.demo ? " that ships" : ""}, on the real screens. You press the real buttons. About five minutes.</>
          : ready ? <>Feedback lands on the Desk, sorted and ranked. Open any issue and follow the line under its progress bar: it always says the next thing to do.</>
            : <>A few things are still open. Each one below goes straight to its step.</>,
        children: <DoneStep c={c} />,
      };
    }
  }
}

function FeedbackStep({ c }: { c: StepContext }) {
  const inbox = (c.demo?.channels ?? c.cards.flatMap((x) => (x.tool === "slack" ? x.channels : []))).find((x) => x.role === "inbox");
  return (
    <>
      <ul className="space-y-2">
        {RAIL_ORDER.map((t, i) => (
          <li key={t} className="rise-in relative pl-4" style={{ animationDelay: `${240 + i * 80}ms` }}>
            <span aria-hidden className="absolute inset-y-1 left-0 w-[3px] rounded-full" style={{ background: `var(--type-${t})` }} />
            <span className="font-medium text-foreground">{RAIL_LABEL[t]}:</span> {CHECKS[t].button}, which {FINDS[t]}.
          </li>
        ))}
      </ul>
      <h2 className="mt-8 font-heading text-xl font-semibold text-foreground">Ways in</h2>
      <ul className="mt-3 space-y-3">
        <li>
          <Link href={c.href("/feedback")} className="link">Add feedback</Link>: paste notes, drop files or upload call recordings. Issues show up on the Desk a minute or two later.
        </li>
        {inbox && (
          <li>Post what people said in {inbox.url ? <a href={inbox.url} target="_blank" rel="noreferrer" className="link">#{inbox.name}</a> : `#${inbox.name}`}{c.demo ? ", or use the Send to PMA shortcut on any Slack message" : ""}.</li>
        )}
        {!c.demo && (
          <>
            <li>
              Collect it as it happens with the in-app widget. Put this before your product&apos;s closing body tag:
              <div className="mt-2"><CopyLink link={c.widgetSnippet} label="Widget snippet" /></div>
            </li>
            <li>
              Or send it from your own systems with your API key (it&apos;s in <Link href={c.href("/settings")} className="link">Settings</Link>):
              <code className="mt-2 block overflow-x-auto whitespace-pre rounded-lg bg-muted p-3 text-xs">{`curl -X POST ${c.apiUrl} \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "content-type: application/json" \\\n  -d '{"text": "The checkout button does nothing on my phone"}'`}</code>
            </li>
          </>
        )}
      </ul>
    </>
  );
}

function DoneStep({ c }: { c: StepContext }) {
  const listed = c.steps.filter((s) => s.key !== "intro" && s.key !== "done");
  return (
    <>
      {c.tour && <TourStart id={c.tour.id} title={c.tour.title} type={c.tour.type} auto={c.tour.auto} />}
      {!c.demo && (
        <ul className={`${c.tour ? "mt-8" : ""} grid gap-2 sm:grid-cols-2`}>
          {listed.map((s, i) => (
            <li key={s.key} className="rise-in" style={{ animationDelay: `${240 + i * 50}ms` }}>
              <Link href={`${c.path}?step=${s.key}`} transitionTypes={["nav-back"]} className="flex items-center gap-3 rounded-lg px-3 py-2 shadow-[0_0_0_1px_var(--border)] outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60">
                {s.done
                  ? <span className="grid size-6 place-items-center rounded-full bg-[var(--stage-ready)] text-white"><Check aria-hidden className="size-3.5" strokeWidth={3} /></span>
                  : <span className="size-6 rounded-full shadow-[inset_0_0_0_1.5px_var(--border)]" />}
                <span className={s.done ? "text-foreground" : "text-muted-foreground"}>{s.label}</span>
                <span className="ml-auto text-xs text-muted-foreground">{s.done ? "Done" : s.optional ? "Optional" : "To do"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {!c.demo && (
        <div className="mt-8">
          <h2 className="font-heading text-lg font-semibold text-foreground">Coming next</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">{COMING_NEXT.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}
    </>
  );
}

/** The demo's Slack step: join the deployment's workspace with the sign-in email, and its channels by type. */
function DemoSlackStep({ slack }: { slack: DemoSlack }) {
  const byRole = new Map(slack.channels.map((x) => [x.role, x]));
  return (
    <>
      <p>{slack.email ? <>Join with <span className="font-medium text-foreground">{slack.email}</span>, the email you signed in with, so your clicks count as you.</> : "Join with the email you signed in with, so your clicks count as you."}</p>
      {slack.invite ? (
        <a href={slack.invite} target="_blank" rel="noreferrer" data-tour="join-slack" className="mt-4 inline-flex h-11 items-center gap-2 btn-ink sheen px-5 text-[15px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
          Join Slack<ExternalLink aria-hidden className="size-4" />
        </a>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">No invite link is set yet. Add SLACK_INVITE_URL to the app&apos;s environment, or ask whoever runs the workspace to invite you.</p>
      )}
      {byRole.size > 1 && (
        <ul className="mt-4 flex flex-wrap gap-2 text-sm">
          {RAIL_ORDER.map((t) => byRole.get(t)).filter((x) => !!x).map((x) => (
            <li key={x!.role}>
              <a href={x!.url ?? undefined} target="_blank" rel="noreferrer" className="btn-paper inline-flex items-center gap-2 rounded-full px-3 py-1">
                <span aria-hidden className="h-3 w-[3px] rounded-full" style={{ background: `var(--type-${x!.role})` }} />#{x!.name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
