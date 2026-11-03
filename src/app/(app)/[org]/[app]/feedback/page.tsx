import { requireApp } from "@/lib/db/app";
import { userDb } from "@/lib/db/server";
import { AddFeedback } from "@/components/sources/AddFeedback";
import { ReceivedList, type ReceivedRow } from "@/components/sources/ReceivedList";
import { loadOutcomes } from "@/lib/sources/outcomes";
import { PageTransition } from "@/components/app/PageTransition";
import { profileOf } from "@/lib/product/profile";

export default async function AddFeedbackPage(props: PageProps<"/[org]/[app]/feedback">) {
  const { org, app } = await props.params;
  const { project, base } = await requireApp(org, app);
  const sp = await props.searchParams;
  const filter = { status: typeof sp.status === "string" ? sp.status : undefined, kind: typeof sp.kind === "string" ? sp.kind : undefined };
  const db = await userDb();
  const { data } = await db.from("sources").select("id,raw_text,author,channel,kind,status,occurred_at,demo,error,metadata").eq("project_id", project.id).order("occurred_at", { ascending: false }).limit(100);
  const rows = (data ?? []) as ReceivedRow[];
  const outcomes = await loadOutcomes(db, rows.map((r) => r.id));
  return (
    <PageTransition><div className="mx-auto max-w-4xl space-y-8 p-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Add feedback</h1>
        <p className="text-sm text-muted-foreground">Anything you add is split into single pieces of feedback, scored, and filed under an issue. Slack, the in-app widget and the API add theirs here on their own.</p>
      </header>
      <AddFeedback demo={project.kind === "demo"} audienceOne={profileOf(project).audience_one} />
      <ReceivedList rows={rows} outcomes={outcomes} filter={filter} base={base} />
    </div></PageTransition>
  );
}
