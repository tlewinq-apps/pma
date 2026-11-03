import { requireApp } from "@/lib/db/app";
import { githubView } from "@/lib/github/view";
import { githubFlashFrom } from "@/components/github/flash";
import { RepositoryCard, SettingsForm } from "./SettingsForm";
import { draftBackend } from "@/lib/drafts/demo";
import { SlackAppCard } from "./SlackAppCard";
import { slackStatus } from "@/lib/slack/setup";
import { slackManifest } from "@/lib/slack/manifest";
import { FeedbackSourcesCard } from "./FeedbackSourcesCard";
import { DemoHealthCard } from "./DemoHealthCard";
import { ConnectionsCard } from "./ConnectionsCard";
import { AlertsCard, type AlertMember } from "./AlertsCard";
import { parseAlertRules } from "@/lib/alerts/rules";
import { slackMatches } from "@/lib/slack/users";
import { serviceDb } from "@/lib/db/server";
import { slackEnabled } from "@/lib/env";
import { readerFor } from "@/lib/marver/sync";
import { PageTransition } from "@/components/app/PageTransition";
import { toolCards } from "@/lib/connections/view";
import { flashFrom } from "@/components/connections/flash";
import { slackIsMine } from "@/lib/slack/ownership";
import { inSlackFor } from "@/lib/slack/tenant";
import Link from "next/link";
import { Users } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/** Members and whether Slack knows their email (alerts are DMs, matched by email; matches are cached for a day). */
async function alertMembers(projectId: string, slackLive: boolean): Promise<AlertMember[]> {
  const { data } = await serviceDb().rpc("service_member_emails", { p_project: projectId });
  const members = ((data ?? []) as { user_id: string; email: string }[]).map((m) => ({ userId: m.user_id, email: m.email }));
  // Looked up in the app's own workspace only.
  const slack = slackLive ? await inSlackFor(projectId, () => slackMatches(members)) : null;
  return members.map((m) => ({ ...m, slack: slack?.get(m.userId) ?? null }));
}

export default async function SettingsPage(props: PageProps<"/[org]/[app]/settings">) {
  const { org, app } = await props.params;
  const { project: p, org: company, role, base } = await requireApp(org, app);
  // The demo keeps its developer Demo health card and its Slack app card; a customer app gets a Connect card per tool.
  const demo = p.kind === "demo";
  // Only pass what the form needs; never ship the full api_key to the browser. The legacy Slack webhook card is the
  // demo's; a customer app gets it only if it already has a saved webhook (so it can be cleared). A webhook URL can post
  // on its own, so only owners and admins (who can change it) get the whole URL; members see its last four characters.
  const hook = p.slack_webhook_url && role === "member" ? `Saved webhook ending in ${p.slack_webhook_url.slice(-4)}` : p.slack_webhook_url;
  const view = {
    repo_full_name: p.repo_full_name, design_path: p.design_path, watched_branch: p.watched_branch,
    slack_webhook_url: hook, widget_key: p.widget_key, widget_origins: p.widget_origins,
    route_map: p.route_map, api_key_prefix: p.api_key.slice(0, 6),
  };
  const backend = draftBackend(p, process.env.GITHUB_TOKEN);
  const canvas = readerFor(p);
  const appUrl = process.env.APP_URL ?? "";
  const publicUrl = appUrl.startsWith("https://");
  const slackLive = slackEnabled() && (await slackIsMine(p.id));
  const slack = await slackStatus(p.id);
  const cards = demo ? [] : await toolCards(p);
  const live = (tool: string) => cards.some((c) => c.tool === tool && c.state === "connected");
  const widgetSources = demo ? 0 : (await serviceDb().from("sources").select("id", { count: "exact", head: true }).eq("project_id", p.id).eq("kind", "widget")).count ?? 0;
  return <PageTransition><div className="mx-auto max-w-3xl space-y-6 p-6"><h1 className="text-3xl font-semibold">Settings</h1>
    <section className="flex flex-wrap items-center justify-between gap-3 surface p-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Company</h2>
        <p className="text-sm text-muted-foreground">Everyone in {company.name} can open this app.{role === "member" ? " See who else is in the company." : " Invite teammates and see who's in the company."}</p>
      </div>
      <Link href={`/${company.slug}/settings/members`} className={buttonVariants({ variant: "outline" })}><Users aria-hidden />Company members</Link>
    </section>
    {/* The demo app's repository is managed by PMA (POST /repo refuses it), so only customer apps get the card. */}
    {!demo && <RepositoryCard key={p.id} repo={p.repo_full_name} branch={p.watched_branch} github={await githubView(company.id)} githubFlash={githubFlashFrom(await props.searchParams)} returnTo={`${base}/settings#repository`} />}
    {demo ? <DemoHealthCard facts={{
      anthropic: !!process.env.ANTHROPIC_API_KEY, voyage: !!process.env.VOYAGE_API_KEY, deepgram: !!process.env.DEEPGRAM_API_KEY,
      slack: { token: !!process.env.SLACK_BOT_TOKEN, signing: !!process.env.SLACK_SIGNING_SECRET, inbox: slackLive },
      drafting: backend, canvas: canvas.fromRepo ? canvas.reader.label : null, appUrl, cron: !!process.env.CRON_SECRET,
    }} /> : <ConnectionsCard
      facts={{ repo: p.repo_full_name, branch: p.repo_full_name ? p.watched_branch : null, widgetSources, widgetOrigins: (p.widget_origins ?? []).length }}
      cards={cards} canEdit={role !== "member"} returnTo={`${base}/settings#connections`} flash={flashFrom(await props.searchParams)}
    />}
    {demo && <SlackAppCard initial={slack} manifest={JSON.stringify(slackManifest(publicUrl ? appUrl : "https://YOUR-APP-URL"), null, 2)} appUrlPublic={publicUrl} />}
    <AlertsCard initial={parseAlertRules(p.alert_rules)} members={await alertMembers(p.id, slackLive)} slackLive={slackLive} customer={!demo} inboxChannel={slack.channels.find((c) => c.role === "inbox")?.name ?? null} />
    <FeedbackSourcesCard slackLive={slackLive} widgetOrigins={(p.widget_origins ?? []).length} customer={!demo} granolaLive={live("granola")} posthogLive={live("posthog")} sentryLive={live("sentry")} />
    <SettingsForm project={view} appUrl={appUrl} demo={demo} /></div></PageTransition>;
}
