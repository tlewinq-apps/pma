import { redirect } from "next/navigation";
import { requireApp } from "@/lib/db/app";
import { appHref } from "@/lib/links";
import { listIssues } from "@/lib/queries/issues";
import { userDb } from "@/lib/db/server";
import { advanceDemoDrafts } from "@/lib/drafts/demoRepo";
import { Hub } from "@/components/triage/Hub";
import { PageTransition } from "@/components/app/PageTransition";
import { parseView } from "@/components/triage/views";
import { deskFeedbackFrom } from "@/lib/product/onboarding";
import { profileOf } from "@/lib/product/profile";

export default async function DeskPage(props: PageProps<"/[org]/[app]">) {
  const { org, app } = await props.params;
  const sp = await props.searchParams;
  const { project, base, email } = await requireApp(org, app);
  // Old deep links (Slack, PR bodies, source highlights) used /?issue=<id>; issues now have their own page.
  if (typeof sp.issue === "string") redirect(appHref(base, `/issues/${encodeURIComponent(sp.issue)}`));
  await advanceDemoDrafts({ projectId: project.id });
  const issues = await listIssues(project.id);
  const db = await userDb();
  const { count } = await db.from("feedback_units").select("id", { count: "exact", head: true }).eq("project_id", project.id).in("type", ["irrelevant", "question"]);
  return (
    <PageTransition><Hub
      issues={issues} filteredCount={count ?? 0} meEmail={email || null}
      initialView={parseView(typeof sp.view === "string" ? sp.view : null)} focusId={typeof sp.focus === "string" ? sp.focus : null}
      feedbackFrom={deskFeedbackFrom(project)} profile={project.kind === "demo" ? null : profileOf(project)}
    /></PageTransition>
  );
}
