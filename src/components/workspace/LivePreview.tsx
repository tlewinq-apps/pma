"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, TriangleAlert, XCircle } from "lucide-react";
import { timeAgo } from "@/components/triage/format";
import type { LiveChecks, LivePr, LiveView } from "@/lib/github/live";

/** While a preview builds or checks run, the page asks again this often; once all is settled it stops. */
const ACTIVE_MS = 20_000;
/** It stops asking after this long anyway (a preview stuck building), until the page is opened or focused again. */
const GIVE_UP_MS = 20 * 60_000;

/** Nothing is on its way any more: no preview building or not yet started by the host, and no checks running. */
export function liveSettled(v: LiveView): boolean {
  return v.prs.every((p) => (p.preview ? p.preview.state !== "building" : v.noPreviews || v.needs !== null)
    && (!p.checks || p.checks.state !== "running"));
}

/**
 * See it live for an issue (GET /api/issues/[id]/live): asked when the page opens and again every 20 seconds while
 * something is still building, and again when the tab comes back into view.
 */
export function useLive(issueId: string, enabled: boolean): { view: LiveView | null; error: string | null; at: number } {
  const [view, setView] = useState<LiveView | null>(null);
  /** When the view was read, for "updated 3 minutes ago". */
  const [at, setAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let started = Date.now();
    const ask = async () => {
      if (timer) clearTimeout(timer);
      try {
        const res = await fetch(`/api/issues/${issueId}/live`, { cache: "no-store" });
        const j = (await res.json().catch(() => null)) as (LiveView & { error?: string }) | null;
        if (stopped) return;
        if (!res.ok || !j || j.error) { setError(j?.error ?? "Couldn't read the preview from GitHub."); }
        else { setView(j); setAt(Date.now()); setError(null); if (liveSettled(j)) return; }
      } catch {
        if (stopped) return;
        setError("Couldn't reach PMA to read the preview.");
      }
      if (Date.now() - started < GIVE_UP_MS) timer = setTimeout(() => void ask(), ACTIVE_MS);
    };
    const onFocus = () => { if (document.visibilityState === "visible") { started = Date.now(); void ask(); } };
    void ask();
    document.addEventListener("visibilitychange", onFocus);
    return () => { stopped = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", onFocus); };
  }, [issueId, enabled]);
  return { view, error, at };
}

const quiet = "inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline";
const button = "btn-ink sheen inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60";

/** The checks on the pull request's latest commit, in one line. */
export function checksLine(c: LiveChecks): string {
  if (c.state === "none") return "No checks ran on it";
  if (c.state === "running") return `Checks running: ${c.passed + c.failed} of ${c.total} done`;
  if (c.state === "failing") return `${c.failed} of ${c.total} ${c.total === 1 ? "check" : "checks"} failed${c.failing.length ? `: ${c.failing.join(", ")}` : ""}`;
  return c.total === 1 ? "Its check passed" : `All ${c.total} checks passed`;
}

function ChecksRow({ c }: { c: LiveChecks }) {
  const icon = c.state === "passing" ? <CheckCircle2 aria-hidden className="size-4 text-[var(--stage-ready)]" />
    : c.state === "failing" ? <XCircle aria-hidden className="size-4 text-[var(--stage-failed)]" />
    : c.state === "running" ? <Loader2 aria-hidden className="size-4 animate-spin text-muted-foreground" /> : null;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className={`inline-flex items-center gap-1.5 ${c.state === "none" ? "text-muted-foreground" : ""}`}>{icon}{checksLine(c)}</span>
      {c.state !== "none" && <a href={c.url} target="_blank" rel="noreferrer" className={quiet}>View checks</a>}
    </p>
  );
}

function PrLive({ pr, view, many, at }: { pr: LivePr; view: LiveView; many: boolean; at: number }) {
  const name = `pull request #${pr.number}`;
  const on = pr.preview?.provider ? ` on ${pr.preview.provider}` : "";
  const p = pr.preview;
  return (
    <div className="space-y-1.5">
      {p?.state === "ready" && p.url ? (
        <div className="space-y-1">
          <a href={p.url} target="_blank" rel="noreferrer noopener" className={button}><ExternalLink aria-hidden className="size-4" />See it live{many ? ` (#${pr.number})` : ""}</a>
          <p className="text-xs text-muted-foreground">The preview of {name}{on}, updated {timeAgo(p.updatedAt, at)}. Check it against the mock-up before it merges.</p>
        </div>
      ) : p?.state === "building" ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" aria-live="polite">
          <span className="inline-flex items-center gap-1.5"><Loader2 aria-hidden className="size-4 animate-spin text-muted-foreground" />Building the preview of {name}{on}</span>
          {p.logUrl && <a href={p.logUrl} target="_blank" rel="noreferrer noopener" className={quiet}>Build log</a>}
        </p>
      ) : p?.state === "failed" ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-1.5"><TriangleAlert aria-hidden className="size-4 text-[var(--stage-failed)]" />The preview of {name} didn&apos;t build{on}</span>
          {p.logUrl && <a href={p.logUrl} target="_blank" rel="noreferrer noopener" className={quiet}>Build log</a>}
        </p>
      ) : view.noPreviews ? (
        <p className="text-xs text-muted-foreground">This repository doesn&apos;t publish preview sites. With Vercel, Netlify or Cloudflare Pages on it, every pull request gets one, and See it live opens it from here.</p>
      ) : view.needs === null ? (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite"><Loader2 aria-hidden className="size-4 animate-spin" />Waiting for the preview of {name}&apos;s latest commit</p>
      ) : null}
      {pr.checks && <ChecksRow c={pr.checks} />}
    </div>
  );
}

/** See it live beside the approved mock-up: each open pull request's preview and checks, or why they can't show. */
export function LivePanel({ view, error, at }: { view: LiveView | null; error: string | null; at: number }) {
  if (!view && !error) return <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Loader2 aria-hidden className="size-4 animate-spin" />Looking for the pull request&apos;s preview</p>;
  if (!view) return <p className="text-sm text-muted-foreground">{error}</p>;
  if (view.needs === "github" || (!view.prs.length && !view.needs)) return null;
  return (
    <section aria-label="See it live" className="space-y-2.5">
      {view.prs.map((pr) => <PrLive key={pr.number} pr={pr} view={view} many={view.prs.length > 1} at={at} />)}
      {view.needs === "permission" && (
        <p className="text-xs text-muted-foreground">
          To show the preview and checks here, accept PMA&apos;s new GitHub permissions (deployments, checks and commit statuses, read only).{" "}
          {view.manageUrl && <a href={view.manageUrl} target="_blank" rel="noreferrer" className="link">Review them on GitHub</a>}
        </p>
      )}
      {error && <p className="text-xs text-muted-foreground">{error} Showing what PMA read last.</p>}
    </section>
  );
}

/** The ready preview of a pull request, if See it live found one. */
export const livePreviewOf = (view: LiveView | null, number: number): string | null => {
  const p = view?.prs.find((x) => x.number === number)?.preview;
  return p?.state === "ready" ? p.url : null;
};
