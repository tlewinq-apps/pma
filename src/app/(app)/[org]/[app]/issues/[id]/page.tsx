import { notFound } from "next/navigation";
import { buildCaps } from "@/lib/build/start";
import { requireApp } from "@/lib/db/app";
import { userDb } from "@/lib/db/server";
import { getIssueDetail } from "@/lib/queries/issueDetail";
import { analysisInputFromDetail, loadPlacement } from "@/lib/queries/issueAnalysis";
import { analyseIssue } from "@/lib/analysis";
import { listIssues } from "@/lib/queries/issues";
import { advanceDemoDrafts } from "@/lib/drafts/demoRepo";
import { demoAdvanceDue } from "@/lib/drafts/demo";
import { groupRails, parseView, viewMatches } from "@/components/triage/views";
import { RAIL_LABEL } from "@/components/triage/format";
import { Workspace } from "@/components/workspace/Workspace";
import { PageTransition } from "@/components/app/PageTransition";
import { slackThreadUrl } from "@/lib/slack/links";
import { posthogIssueView } from "@/lib/posthog/issueView";
import { posthogUsersByIssue } from "@/lib/posthog/reach";
import { sentryIssueView } from "@/lib/sentry/issueView";

/** Request time, read once per server render; the workspace uses it for "3 min ago" labels and draft timing. */
const requestTime = () => Date.now();

export default async function IssuePage(props: PageProps<"/[org]/[app]/issues/[id]">) {
  const { org, app, id } = await props.params;
  const sp = await props.searchParams;
  const { project, email } = await requireApp(org, app);
  let d = await getIssueDetail(id); // RLS-scoped: only advance demo drafts on issues this user can see
  // An issue from another of the user's apps belongs under that app's URL, not this one.
  if (!d || d.project_id !== project.id) notFound();
  if (demoAdvanceDue(d.draft, requestTime())) { await advanceDemoDrafts({ issueId: id }); d = (await getIssueDetail(id)) ?? d; }
  // Build it needs the company's GitHub installation to accept write access; the query can't read connections.
  if (project.kind !== "demo") d = { ...d, project: { ...d.project, build_caps: await buildCaps(project.org_id) } };
  // Prev / next walk the same rail, in the same order, as the view the user came from: its type's rail, or the urgent
  // rail on top when the issue is urgent.
  const from = parseView(typeof sp.from === "string" ? sp.from : null);
  const db = await userDb();
  const now = requestTime();
  const [issues, slackUrl, placement, posthog, sentry, phUsers] = await Promise.all([
    listIssues(project.id, now), slackThreadUrl(id), loadPlacement(db, project.id, d.flow),
    project.kind === "demo" ? Promise.resolve(null) : posthogIssueView(db, project.id, id).catch(() => null),
    project.kind === "demo" ? Promise.resolve(null) : sentryIssueView(db, project.id, id).catch(() => null),
    // The same count the Desk's urgency badge reads, so Why it matters shows the same number.
    posthogUsersByIssue(db, project.id, [{ id, frames: d.flow.map((s) => s.frame_id) }]),
  ]);
  const home = groupRails(issues.filter((i) => i.id === id || viewMatches(from, i, email || null))).find((r) => r.items.some((i) => i.id === id));
  const rail = home?.items ?? [];
  const k = rail.findIndex((i) => i.id === id);
  const nav = (i: (typeof rail)[number] | undefined) => (i ? { id: i.id, title: i.title } : null);
  return (
    <PageTransition><Workspace
      d={d} now={now} from={from} railLabel={home?.label ?? RAIL_LABEL[d.type]} prev={k > 0 ? nav(rail[k - 1]) : null} next={k >= 0 ? nav(rail[k + 1]) : null} me={email || null} slackUrl={slackUrl}
      analysis={analyseIssue({ ...analysisInputFromDetail(d), phUsers30: phUsers.get(id) ?? 0 }, now)} placement={placement} posthog={posthog} sentry={sentry}
    /></PageTransition>
  );
}
