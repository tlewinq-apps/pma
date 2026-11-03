/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase nested selects are untyped */
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, GitPullRequest, TriangleAlert } from "lucide-react";
import { diffLines } from "diff";
import { userDb } from "@/lib/db/server";
import { requireApp } from "@/lib/db/app";
import { appHref } from "@/lib/links";
import { screenSources } from "@/lib/marver/sources";
import { PageTransition } from "@/components/app/PageTransition";
import { APPROXIMATE_LABEL, isApproximate, mockupFailure } from "@/lib/drafts/codeMockup";

type Img = { frame_id: string; url: string };
const STATE: Record<string, string> = { open: "Open", merged: "Merged", closed: "Closed" };

/** An approximate mock-up's page: what changes, today and proposed side by side, and nothing that reads as a pull request. */
function ApproximateMockup({ x, before, after, frames, back }: { x: any; before: Img[]; after: Img[]; frames: string[]; back: string }) {
  const failure = x.status === "failed" ? mockupFailure(x.log_url) : null;
  return (
    <PageTransition><div className="mx-auto max-w-5xl space-y-6 p-6">
      <Link href={back} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft aria-hidden className="size-3" />Back to the issue</Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{x.solutions?.title ?? x.issues?.title ?? "Mock-up"}</h1>
        <p className="text-sm text-muted-foreground">For {x.issues?.title}</p>
      </header>
      <p className="surface px-4 py-3 text-sm text-muted-foreground">{APPROXIMATE_LABEL}</p>
      {x.solutions?.summary && <section className="space-y-1"><h2 className="text-lg font-semibold">What changes</h2><p className="text-[15px]">{x.solutions.summary}</p></section>}
      {x.status === "failed" && <p role="alert" className="flex items-center gap-2 text-[15px]"><TriangleAlert aria-hidden className="size-4 text-[var(--stage-failed)]" />The mock-up didn&apos;t finish.{failure ? ` ${failure}` : ""}</p>}
      {frames.map((f) => (
        <section key={f} className="grid gap-4 sm:grid-cols-2">
          {[["Today", before.find((i) => i.frame_id === f)], ["Proposed", after.find((i) => i.frame_id === f)]].map(([label, img]) => (
            <figure key={label as string} className="space-y-1.5">
              <figcaption className="text-sm text-muted-foreground">{label as string}</figcaption>
              {/* eslint-disable-next-line @next/next/no-img-element -- public Storage PNGs */}
              {img ? <img src={(img as Img).url} alt={`${label}, approximate`} className="w-full rounded-xl border bg-card shadow-paper" /> : <p className="text-sm text-muted-foreground">Not drawn</p>}
            </figure>
          ))}
        </section>
      ))}
    </div></PageTransition>
  );
}

/**
 * The pull request a mock-runner draft would have opened. Everything here came through the real dispatch and callback
 * (branch, changed frame files, uploaded screenshots); only GitHub itself is simulated.
 */
export default async function MockPullRequest(props: PageProps<"/[org]/[app]/mock/pr/[draftId]">) {
  const { org, app, draftId } = await props.params;
  const { project, base } = await requireApp(org, app);
  const db = await userDb();
  const { data: d } = await db.from("drafts")
    .select("id, issue_id, backend, status, branch, pr_number, pr_state, marver_paths, before_images, after_images, frames, log_url, created_at, solutions(title, summary), issues(title, short_id, project_id)")
    .eq("id", draftId).maybeSingle();
  if (!d || (d as any).backend !== "mock" || (d as any).issues?.project_id !== project.id) notFound();
  const x = d as any;
  const before: Img[] = x.before_images ?? [], after: Img[] = x.after_images ?? [];
  const frames = [...new Set([...before, ...after].map((i) => i.frame_id))];
  // A customer app's mock-runner draft is an approximate mock-up drawn from its code: there is no pull request to show.
  if (isApproximate(x, project)) return <ApproximateMockup x={x} before={before} after={after} frames={frames} back={appHref(base, `/issues/${x.issue_id}`)} />;
  const files = [...(x.marver_paths ?? []), ...(x.issues?.short_id ? [`design/boards/pma-${x.issues.short_id}.json`] : [])];
  // The design agent's edit to each Marver frame, as a diff against the frame on the canvas today.
  const edited = (x.frames ?? []) as { frame_id: string; path: string; source: string }[];
  const today = new Map((await screenSources(db, project.id, edited.map((f) => f.frame_id))).map((s) => [s.frame_id, s.source ?? ""]));
  const diffs = edited.map((f) => ({ path: f.path, parts: diffLines(today.get(f.frame_id) ?? "", f.source) }));
  return (
    <PageTransition><div className="mx-auto max-w-4xl space-y-6 p-6">
      <Link href={appHref(base, `/issues/${x.issue_id}`)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft aria-hidden className="size-3" />Back to the issue</Link>
      <p className="surface px-4 py-3 text-sm text-muted-foreground">
        Simulated pull request: no GitHub repo is connected, so PMA&apos;s mock runner played the drafting step. It went through the same dispatch, screenshot upload and callback as a real Marver draft; with a design repo connected, this would be a pull request on GitHub.
      </p>
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><GitPullRequest aria-hidden className="size-5" />{x.solutions?.title ?? x.issues?.title ?? "Draft"} <span className="font-sans text-base font-normal text-muted-foreground">#{x.pr_number}</span></h1>
        <p className="text-sm text-muted-foreground">{STATE[x.pr_state] ?? "Waiting"} · <code className="text-foreground/80">{x.branch}</code> into <code className="text-foreground/80">main</code> · for {x.issues?.title}</p>
      </header>
      {x.solutions?.summary && <section className="space-y-1"><h2 className="text-lg font-semibold">What changes</h2><p className="text-[15px]">{x.solutions.summary}</p></section>}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Files changed</h2>
        <ul className="surface divide-y overflow-hidden text-sm">{files.map((f: string) => <li key={f} className="px-3.5 py-2"><code>{f}</code></li>)}</ul>
      </section>
      {diffs.map((f) => (
        <section key={f.path} className="space-y-2">
          <h2 className="text-lg font-semibold"><code className="text-base">{f.path}</code></h2>
          <pre className="surface overflow-x-auto py-3 text-[12.5px] leading-[1.55]">
            {f.parts.flatMap((part, k) => part.value.replace(/\n$/, "").split("\n").map((line, j) => (
              <div key={`${k}-${j}`} className={`px-3 ${part.added ? "bg-[var(--stage-ready)]/10" : part.removed ? "bg-[var(--stage-failed)]/10" : ""}`}>
                <span aria-hidden className="mr-3 inline-block w-3 select-none text-muted-foreground">{part.added ? "+" : part.removed ? "-" : " "}</span>{line}
              </div>
            )))}
          </pre>
        </section>
      ))}
      {frames.map((f) => (
        <section key={f} className="space-y-2">
          <h2 className="text-lg font-semibold">{f}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {[["Current", before.find((i) => i.frame_id === f)], ["Proposed", after.find((i) => i.frame_id === f)]].map(([label, img]) => (
              <figure key={label as string}>
                {/* eslint-disable-next-line @next/next/no-img-element -- public Storage PNGs */}
                {img ? <img src={(img as Img).url} alt={`${label} ${f}`} className="w-full rounded-xl border bg-card shadow-paper" /> : <p className="text-sm text-muted-foreground">No screenshot</p>}
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div></PageTransition>
  );
}
