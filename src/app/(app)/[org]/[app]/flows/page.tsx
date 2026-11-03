import { requireApp } from "@/lib/db/app";
import { userDb } from "@/lib/db/server";
import { canvasBoardUrl } from "@/lib/marver/canvas";
import { screenSources } from "@/lib/marver/sources";
import { buildJourneys, screenNotes } from "@/components/flows/journey";
import { FlowList } from "@/components/flows/FlowList";
import { PageTransition } from "@/components/app/PageTransition";
import { profileOf } from "@/lib/product/profile";

/** Every flow board on the Marver canvas as a journey of real screens, with what feedback says about each step. */
export default async function FlowsPage(props: PageProps<"/[org]/[app]/flows">) {
  const { org, app } = await props.params;
  const { project, base } = await requireApp(org, app);
  const db = await userDb();
  const [{ data: screens }, { data: flows }, { data: links }, { data: praise }] = await Promise.all([
    db.from("screens").select("id, frame_id, title").eq("project_id", project.id).order("frame_id"),
    db.from("flows").select("board, title, description, frames, position").eq("project_id", project.id).order("position"),
    db.from("issue_screens").select("screen_id, issues!inner(id, status, score_breakdown, project_id)").eq("issues.project_id", project.id),
    db.from("unit_screens").select("screen_id, feedback_units!inner(type, project_id)").eq("feedback_units.type", "praise").eq("feedback_units.project_id", project.id),
  ]);
  const rows = (screens ?? []) as { id: string; frame_id: string; title: string | null }[];
  // Screens synced before sources were kept read theirs from the canvas.
  const sources = new Map((await screenSources(db, project.id, rows.map((s) => s.frame_id))).map((s) => [s.frame_id, s.source]));
  const { journeys, others } = buildJourneys(
    flows ?? [],
    rows.map((s) => ({ ...s, source: sources.get(s.frame_id) ?? null })),
    // One issue per link (many-to-one), though the untyped client reads the embed as a list.
    screenNotes((links ?? []) as unknown as Parameters<typeof screenNotes>[0], praise ?? []),
    canvasBoardUrl,
  );
  return (
    <PageTransition><div className="space-y-8 p-6">
      <header className="max-w-3xl space-y-1">
        <h1 className="text-3xl font-semibold">Flows</h1>
        <p className="text-sm text-muted-foreground">Each flow on the Marver canvas, screen by screen. Between two screens is what the {profileOf(project).audience_one} taps to move on; under each screen is what feedback says about it.</p>
      </header>
      {rows.length
        ? <FlowList journeys={journeys} others={others} base={base} />
        : <p className="text-sm text-muted-foreground">{project.kind === "demo"
          ? "No screens yet. Press Sync screens now in Settings: it reads the built-in sample design until a design repo is connected."
          : "No screens yet. Flows come from a Marver canvas (a design folder) in your repository. Without one, PMA still files issues, reads your code and writes proposals."}</p>}
    </div></PageTransition>
  );
}
