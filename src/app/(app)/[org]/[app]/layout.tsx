import { Sidebar } from "@/components/app/Sidebar";
import { Tour } from "@/components/app/Tour";
import { GlareTracker } from "@/components/app/GlareTracker";
import { AppProvider, type AppValue } from "@/components/app/AppContext";
import { RememberApp } from "@/components/app/RememberApp";
import { LAST_APP_COOKIE, requireApp } from "@/lib/db/app";
import { slackInviteFor } from "@/lib/slack/ownership";
import { profileOf } from "@/lib/product/profile";

// The frame: the sidebar sits on the grained stone ground and the page is one raised sheet beside it. The sheet is the
// scroll container, so its rounded edge stays put while the page scrolls. Nothing here may take a transform or filter:
// that would re-anchor the Tour's fixed outline.
export default async function AppLayout(props: LayoutProps<"/[org]/[app]">) {
  const { org, app } = await props.params;
  const ctx = await requireApp(org, app); // a 404 for anyone outside the company
  // Only what client components need. ctx.project holds the API key, the widget key and the Slack webhook.
  const value: AppValue = { orgSlug: ctx.org.slug, appSlug: ctx.project.slug, appId: ctx.project.id, base: ctx.base, role: ctx.role };
  // SLACK_INVITE_URL is the deployment's own workspace (the demo's). An app on a company's own workspace gets no Join
  // Slack link and no tour step for it (the Tour skips that step without an invite).
  const invite = await slackInviteFor(ctx.project.id);
  // PMA's own feedback widget, reporting to whichever app PMA_FEEDBACK_WIDGET_KEY belongs to. Never the open
  // app's widget key: that would file PMA's feedback inside a customer's app.
  const widgetKey = process.env.PMA_FEEDBACK_WIDGET_KEY;
  // The tour says who gives this app feedback in its own words ("members" in the demo).
  const profile = profileOf(ctx.project);
  return (
    <AppProvider value={value}>
      <div className="ground flex h-dvh overflow-hidden">
        <Sidebar email={ctx.email} slackInvite={invite} />
        <main id="sheet" className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-background shadow-sheet md:my-2 md:mr-2 md:rounded-2xl">{props.children}</main>
        <Tour hasInvite={!!invite} email={ctx.email || null} audience={{ one: profile.audience_one, many: profile.audience }} />
        <GlareTracker />
        <RememberApp name={LAST_APP_COOKIE} value={`${ctx.org.slug}/${ctx.project.slug}`} />
        {widgetKey && <script src="/widget.js" data-project={widgetKey} async />}
      </div>
    </AppProvider>
  );
}
