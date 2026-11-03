import { requireApp } from "@/lib/db/app";
import { listIssues } from "@/lib/queries/issues";
import { getIssueDetail } from "@/lib/queries/issueDetail";
import { projectTimeline, threadComments } from "@/lib/queries/projectHelpers";
import { advanceDemoDrafts } from "@/lib/drafts/demoRepo";
import { displayNames } from "@/lib/slack/users";
import { slackThreadUrl } from "@/lib/slack/links";
import { nameFromEmail } from "@/components/triage/format";
import { ProjectList, type ProjectRow } from "@/components/projects/ProjectList";
import { ProjectDetail } from "@/components/projects/ProjectDetail";
import { PageTransition } from "@/components/app/PageTransition";

/** Request time, read once per server render, for "2 h ago" labels and stage timing. */
const requestTime = () => Date.now();

/**
 * Every issue someone owns, as a project: the ones in flight, then the shipped ones. The selected one (?p=) opens
 * beside the list with its progress, its before and after, what was done and why, and its updates and comments.
 */
export default async function WorkPage(props: PageProps<"/[org]/[app]/work">) {
  const { org, app } = await props.params;
  const sp = await props.searchParams;
  const { project, userId, base } = await requireApp(org, app);
  await advanceDemoDrafts({ projectId: project.id });
  const owned = (await listIssues(project.id)).filter((i) => i.owner);
  const names = await displayNames(project.id, owned.map((i) => i.owner!.id));
  const rows: ProjectRow[] = owned.map((i) => ({ ...i, ownerName: names.get(i.owner!.id) ?? nameFromEmail(i.owner!.email) }));
  const ongoing = rows.filter((i) => i.status !== "shipped").sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at));
  const shipped = rows.filter((i) => i.status === "shipped").sort((a, b) => (b.approved_at ?? b.last_activity_at).localeCompare(a.approved_at ?? a.last_activity_at));

  const asked = typeof sp.p === "string" ? sp.p : null;
  const selected = rows.find((r) => r.id === asked) ?? ongoing[0] ?? shipped[0] ?? null;
  const d = selected ? await getIssueDetail(selected.id) : null;
  const now = requestTime();

  let detail: React.ReactNode = <p className="text-sm text-muted-foreground">Pick a project to see how it&apos;s going.</p>;
  if (d && selected) {
    const people = await displayNames(project.id, [selected.owner!.id, ...d.activity.map((a) => a.user_id)]);
    const ctx = { type: d.type, solutions: d.solutions, draftSolutionId: d.draft?.solution_id ?? null };
    detail = (
      <ProjectDetail
        d={d} ownerName={selected.ownerName} now={now} isOwner={selected.owner!.id === userId}
        steps={projectTimeline(d.activity, people, ctx)} threads={threadComments(d.activity, people, selected.owner!.id)}
        slackUrl={await slackThreadUrl(d.id)} base={base}
      />
    );
  }

  return (
    <PageTransition><div className="flex flex-col gap-5 p-6 lg:h-full lg:overflow-hidden">
      <header className="max-w-3xl space-y-1">
        <h1 className="text-3xl font-semibold">Work</h1>
        <p className="text-sm text-muted-foreground">Every issue someone owns: how far it got, who did what and why, and what the team is saying about it.</p>
      </header>
      <div className="grid min-h-0 flex-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
        <div className="-m-2 min-h-0 overflow-y-auto p-2">
          <ProjectList ongoing={ongoing} shipped={shipped} selectedId={selected?.id ?? null} now={now} base={base} demo={project.kind === "demo"} />
        </div>
        <div className="surface flex min-h-0 flex-col p-6">{detail}</div>
      </div>
    </div></PageTransition>
  );
}
