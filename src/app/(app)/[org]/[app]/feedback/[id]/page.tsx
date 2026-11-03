/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, PanelRightOpen } from "lucide-react";
import { serviceDb, userDb } from "@/lib/db/server";
import { requireApp } from "@/lib/db/app";
import { appHref } from "@/lib/links";
import { ownedPath } from "@/lib/ingest/files";
import { Highlights } from "@/components/sources/Highlights";
import { RetryButton } from "@/components/sources/RetryButton";
import { loadOutcomes } from "@/lib/sources/outcomes";
import { KIND_LABEL, durationLabel, sourceKind, summarizeSource } from "@/lib/sources/summary";
import type { NamedSpeaker } from "@/lib/transcribe/types";
import { TYPE_LABEL } from "@/components/triage/format";
import { analyseIssue, placeOnFlow } from "@/lib/analysis";
import { loadFlows, loadIssueReadings } from "@/lib/queries/issueAnalysis";
import { ScoreColumns } from "@/components/analysis/ScoreColumns";
import { PieceReading, type Piece } from "@/components/analysis/PieceReading";
import type { IssueType } from "@/lib/types";
import { PageTransition } from "@/components/app/PageTransition";
import { profileOf } from "@/lib/product/profile";

/** Request time, read once per server render, for "last heard" in the issue readings. */
const requestTime = () => Date.now();

export default async function SourceDetail(props: PageProps<"/[org]/[app]/feedback/[id]">) {
  const { org, app, id } = await props.params;
  const { project, base } = await requireApp(org, app);
  const db = await userDb();
  const { data: s } = await db.from("sources").select("id,project_id,raw_text,author,channel,kind,status,occurred_at,error,metadata,file_path").eq("id", id).single();
  // Readable (RLS) is not enough: a source from another of the user's apps belongs under that app's URL.
  if (!s || s.project_id !== project.id) notFound();
  const [{ data: units }, outcomes, flows] = await Promise.all([
    db.from("feedback_units")
      .select("id,quote,span_start,span_end,type,issue_id,filtered_reason,sentiment,emotion,audience,speakers,corroborators,reported_count,severity_signals,unit_screens(confidence,screens(frame_id,title))")
      .eq("source_id", id).order("span_start", { ascending: true, nullsFirst: false }),
    loadOutcomes(db, [id]),
    loadFlows(db, s.project_id),
  ]);
  const rows = (units ?? []) as any[];
  const readings = await loadIssueReadings(db, [...new Set(rows.map((u) => u.issue_id).filter(Boolean))] as string[]);
  const now = requestTime();
  const kind = sourceKind(s);
  const summary = summarizeSource({ status: s.status, kind: s.kind, rawTextEmpty: !s.raw_text.trim(), error: s.error }, outcomes.units.get(id) ?? [], outcomes.titles, outcomes.created.get(id) ?? new Set());
  const created = outcomes.created.get(id) ?? new Set<string>();

  const pieces: (Piece & { issue_id: string | null })[] = rows.map((u) => {
    const screens = ((u.unit_screens ?? []) as any[]).filter((x) => x.screens).map((x) => ({ frame_id: x.screens.frame_id, title: x.screens.title, confidence: x.confidence }));
    const top = [...screens].sort((a, b) => b.confidence - a.confidence)[0];
    const placed = placeOnFlow(flows, screens);
    return {
      id: u.id, quote: u.quote, type: u.type, filtered_reason: u.filtered_reason, issue_id: u.issue_id,
      sentiment: u.sentiment, emotion: u.emotion, audience: u.audience, speakers: u.speakers ?? [], corroborators: u.corroborators ?? [], reported_count: u.reported_count ?? 0,
      signals: u.severity_signals, where: placed?.text ?? (top ? top.title ?? top.frame_id : null), match: top?.confidence ?? null,
    };
  });
  const byIssue = new Map<string, typeof pieces>();
  for (const p of pieces) if (p.issue_id) byIssue.set(p.issue_id, [...(byIssue.get(p.issue_id) ?? []), p]);
  const praise = pieces.filter((p) => !p.issue_id && p.type === "praise");
  const setAside = pieces.filter((p) => !p.issue_id && (p.type === "question" || p.type === "irrelevant"));
  const unfiled = pieces.filter((p) => !p.issue_id && !praise.includes(p) && !setAside.includes(p));

  const meta = (s.metadata ?? {}) as { filename?: string; participants?: string; transcript?: { speakers: NamedSpeaker[]; durationSec: number | null } };
  // The row was readable through the user's session (RLS), but members can write file_path, so only a path in this
  // app's own upload folder is signed (ownedPath); anything else is treated as no file.
  // The link is on Storage's origin, where a `download` attribute is ignored, so Storage names the download instead.
  const filePath = ownedPath(s.project_id, s.file_path);
  const original = filePath ? (await serviceDb().storage.from("uploads").createSignedUrl(filePath, 600, { download: meta.filename ?? true })).data?.signedUrl : null;
  const speakers = meta.transcript?.speakers ?? [];
  const roles = new Map(speakers.filter((p) => p.name).map((p) => [p.name.trim().toLowerCase(), p.role]));
  const profile = profileOf(project);
  const reading = (p: Piece) => <PieceReading key={p.id} p={p} author={s.author} roles={roles} profile={profile} />;

  return (
    <PageTransition><div className="mx-auto max-w-5xl space-y-8 p-6">
      <Link href={appHref(base, "/feedback")} transitionTypes={["nav-back"]} className="group inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft aria-hidden className="size-3 transition-transform duration-300 ease-smooth group-hover:-translate-x-0.5" />Add feedback</Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{s.author ?? "Unknown"}</h1>
        <p className="text-sm text-muted-foreground">{[KIND_LABEL[kind], meta.filename ?? s.channel ?? "Added by hand", new Date(s.occurred_at).toLocaleDateString(undefined, { dateStyle: "medium" })].join(", ")}</p>
        <div className="flex items-center gap-3"><p className="text-[15px]">{summary}</p>{s.status === "failed" && <RetryButton id={s.id} />}</div>
      </header>

      {[...byIssue].map(([issueId, list]) => {
        const r = readings.get(issueId);
        const a = r ? analyseIssue(r.input, now) : null;
        const type = (r?.type ?? list[0].type) as IssueType;
        return (
          <section key={issueId} aria-labelledby={`issue-${issueId}`} className="surface relative overflow-hidden">
            <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ background: `var(--type-${type})` }} />
            <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-6 pt-5">
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap gap-x-4 text-[13px]">
                  <span className="font-semibold" style={{ color: `var(--type-${type})` }}>{TYPE_LABEL[type] ?? type}</span>
                  <span className="text-muted-foreground">{created.has(issueId) ? "Started by this feedback" : "Joined an issue already on the Desk"}</span>
                </p>
                <h2 id={`issue-${issueId}`} className="font-heading text-[26px] font-semibold leading-tight"><Link href={appHref(base, `/issues/${issueId}`)} className="hover:underline">{r?.title ?? outcomes.titles.get(issueId) ?? "Issue"}</Link></h2>
              </div>
              <Link href={appHref(base, `/issues/${issueId}?why=1`)} className="btn-paper inline-flex h-10 shrink-0 items-center gap-2 px-3.5 text-[14px]">Open the full analysis<PanelRightOpen aria-hidden className="size-4" /></Link>
            </header>
            {a ? (
              <div className="space-y-4 px-6 pt-4 pb-5">
                <p className="max-w-[60ch] font-heading text-[19px] leading-snug">{a.verdict}</p>
                <ScoreColumns a={a} size="compact" />
              </div>
            ) : <p className="px-6 pt-3 pb-5 text-[14px] text-muted-foreground">Not rated yet. The scores appear once PMA has rated this issue.</p>}
            <div className="divide-y divide-border border-t border-border">{list.map(reading)}</div>
          </section>
        );
      })}

      {praise.length > 0 && (
        <section aria-labelledby="praise" className="surface relative overflow-hidden">
          <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-tone-positive" />
          <header className="px-6 pt-5 pb-3"><h2 id="praise" className="font-heading text-[22px] font-semibold leading-tight">What they liked</h2><p className="text-[13px] text-muted-foreground">Praise is kept with the screen it&apos;s about, not filed as an issue.</p></header>
          <div className="divide-y divide-border border-t border-border">{praise.map(reading)}</div>
        </section>
      )}

      {unfiled.length > 0 && (
        <section aria-labelledby="unfiled" className="surface overflow-hidden">
          <header className="px-6 pt-5 pb-3"><h2 id="unfiled" className="font-heading text-[22px] font-semibold leading-tight">Not filed yet</h2><p className="text-[13px] text-muted-foreground">These are still being matched to an issue.</p></header>
          <div className="divide-y divide-border border-t border-border">{unfiled.map(reading)}</div>
        </section>
      )}

      {setAside.length > 0 && (
        <section aria-labelledby="set-aside" className="surface overflow-hidden">
          <header className="px-6 pt-5 pb-3"><h2 id="set-aside" className="font-heading text-[22px] font-semibold leading-tight">Set aside</h2><p className="text-[13px] text-muted-foreground">Not a product problem, so it wasn&apos;t scored.</p></header>
          <div className="divide-y divide-border border-t border-border">{setAside.map(reading)}</div>
        </section>
      )}

      {kind === "recording" && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Recording</h2>
          <dl className="surface divide-y divide-border overflow-hidden text-sm">
            <div className="grid grid-cols-[7.5rem_1fr] gap-3 px-3.5 py-2.5"><dt className="text-muted-foreground">Speakers</dt>
              <dd>{speakers.length ? speakers.map((p) => (p.role === "other" ? p.name : `${p.name} (${p.role})`)).join(", ") : meta.participants ?? "Named once it is transcribed"}</dd></div>
            {meta.transcript?.durationSec != null && <div className="grid grid-cols-[7.5rem_1fr] gap-3 px-3.5 py-2.5"><dt className="text-muted-foreground">Length</dt><dd>{durationLabel(meta.transcript.durationSec)}</dd></div>}
            {original && <div className="grid grid-cols-[7.5rem_1fr] gap-3 px-3.5 py-2.5"><dt className="text-muted-foreground">Original</dt><dd><a href={original} className="link">Download {meta.filename ?? "the recording"}</a></dd></div>}
          </dl>
        </section>
      )}

      {s.raw_text.trim() && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">What was said</h2>
          <p className="text-xs text-muted-foreground">Underlined parts became feedback (colour shows the type, green is praise): click one to see what was read in it. Grey parts were set aside.</p>
          <Highlights raw={s.raw_text} units={rows} />
        </section>
      )}
    </div></PageTransition>
  );
}
