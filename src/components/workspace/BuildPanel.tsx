"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, GitPullRequest, Loader2, RotateCw, TriangleAlert } from "lucide-react";
import type { IssueDetail } from "@/lib/queries/issueDetail";
import { useApp } from "@/components/app/AppContext";
import { timeAgo } from "@/components/triage/format";
import { BUILD_VERB, buildProgress, prName, SHIP_ALREADY, SHIP_CONFIRM, SHIP_NOTE, type BuildProgress, type BuildView, type PullRequestLink } from "@/lib/handoff/build";
import { Disclosure } from "@/components/ui/disclosure";
import { HandoffButton } from "./HandoffButton";
import { livePreviewOf } from "./LivePreview";
import type { LiveView } from "@/lib/github/live";
import { CLAUDE_CARD_ID, PULL_TASK_NOTE } from "@/lib/mcp/connect";

const primary = "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60";
const quiet = "inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline";

/** Ready to build, then the pull request, its preview, and Shipped: where an approved mock-up is on its way out. */
function Track({ p, livePreview }: { p: BuildProgress; livePreview: boolean }) {
  const preview = !!p.preview || livePreview;
  const steps = [
    { key: "ready", label: "Ready to build", done: true },
    { key: "pr", label: "Pull request", done: p.pullRequests.length > 0 },
    { key: "preview", label: preview || p.shipped ? "Preview" : "Preview (optional)", done: preview },
    { key: "shipped", label: "Shipped", done: p.shipped },
  ];
  const current = p.shipped ? -1 : steps.findIndex((s) => !s.done && s.key !== "preview");
  return (
    <ol aria-label="On the way to shipped" data-tour="build-track" className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px]">
      {steps.map((s, k) => (
        <li key={s.key} aria-current={k === current ? "step" : undefined} className="flex items-center gap-2">
          <span aria-hidden className={`grid size-4 shrink-0 place-items-center rounded-full border-2 ${s.done ? "border-foreground bg-foreground text-background" : k === current ? "border-brand bg-brand" : "border-foreground/25"}`}>
            {s.done && <Check className="size-2.5" strokeWidth={3} />}
          </span>
          <span className={s.done || k === current ? "text-foreground" : "text-muted-foreground"}>{s.label}<span className="sr-only">{s.done ? ", done" : k === current ? ", current step" : ""}</span></span>
          {k < steps.length - 1 && <span aria-hidden className={`h-[2px] w-3 rounded-full ${s.done ? "bg-foreground/60" : "bg-foreground/15"}`} />}
        </li>
      ))}
    </ol>
  );
}

/**
 * Build it, while PMA works or after it stopped: what it's doing now (the page refreshes itself every few seconds),
 * or why it stopped, with Try again for the people who may link a pull request.
 */
function BuildStatus({ build, now, mayRetry, busy, onRetry }: { build: BuildView | null; now: number; mayRetry: boolean; busy: boolean; onRetry: () => void }) {
  const router = useRouter();
  const working = !build || build.status === "queued" || build.status === "running";
  useEffect(() => {
    if (!build || !working) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [build, working, router]);
  const retry = mayRetry && (
    <button type="button" onClick={onRetry} disabled={busy} className={`${primary} btn-ink sheen`}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}{build ? "Try again" : "Start building"}
    </button>
  );
  if (!build) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-[15px] font-medium">PMA hasn&apos;t started building it</p>
        {retry}
      </div>
    );
  }
  if (build.status === "failed") {
    return (
      <div className="space-y-1.5" role="alert">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="flex items-center gap-2 text-[15px] font-medium"><TriangleAlert className="size-4 text-[var(--stage-failed)]" />The build didn&apos;t finish</p>
          {retry}
        </div>
        {build.error && <p className="text-sm text-muted-foreground">{build.error}</p>}
      </div>
    );
  }
  const last = build.steps[build.steps.length - 1] ?? "Starting";
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-2 text-[15px] font-medium" aria-live="polite">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />Building it with Claude{build.mode === "branch" && build.head_branch ? <> on <code className="text-sm">{build.head_branch}</code></> : null}
      </p>
      <p className="text-sm text-muted-foreground">{last}. Started {timeAgo(build.created_at, now)}; it usually takes a few minutes.</p>
    </div>
  );
}

type FormState = { url: string; preview: string };

/** Paste the pull request (and optionally its preview). */
function LinkForm({ repo, busy, errors, onSubmit, onCancel }: {
  repo: string | null; busy: boolean; errors: { url?: string; preview?: string; other?: string };
  onSubmit: (f: FormState) => void; onCancel: () => void;
}) {
  const [f, setF] = useState<FormState>({ url: "", preview: "" });
  return (
    <form className="grid gap-2 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)_auto] sm:items-start" onSubmit={(e) => { e.preventDefault(); onSubmit(f); }}>
      <div className="min-w-0 space-y-1">
        <label htmlFor="pr-url" className="text-xs text-muted-foreground">Pull request link</label>
        <input id="pr-url" autoFocus required value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} disabled={busy}
          placeholder={`https://github.com/${repo ?? "owner/repo"}/pull/123`} aria-invalid={!!errors.url} aria-describedby={errors.url ? "pr-url-error" : undefined}
          className="field h-9 w-full px-2.5 text-sm outline-none" />
        {errors.url && <p id="pr-url-error" role="alert" className="text-xs text-[var(--stage-failed)]">{errors.url}</p>}
      </div>
      <div className="min-w-0 space-y-1">
        <label htmlFor="pr-preview" className="text-xs text-muted-foreground">Preview link (optional)</label>
        <input id="pr-preview" value={f.preview} onChange={(e) => setF({ ...f, preview: e.target.value })} disabled={busy}
          placeholder="https://your-preview.vercel.app" aria-invalid={!!errors.preview} aria-describedby={errors.preview ? "pr-preview-error" : undefined}
          className="field h-9 w-full px-2.5 text-sm outline-none" />
        {errors.preview && <p id="pr-preview-error" role="alert" className="text-xs text-[var(--stage-failed)]">{errors.preview}</p>}
      </div>
      <div className="flex items-center gap-1 sm:pt-5">
        <button type="submit" disabled={busy || !f.url.trim()} className={`${primary} btn-ink sheen`}>{busy && <Loader2 className="size-4 animate-spin" />}Link</button>
        <button type="button" onClick={onCancel} disabled={busy} className="h-10 px-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
      </div>
      {errors.other && <p role="alert" className="text-sm text-[var(--stage-failed)] sm:col-span-3">{errors.other}</p>}
    </form>
  );
}

/**
 * One linked pull request: its link, its preview ("See it live"), and for people who may link, add a preview or remove
 * it. A preview GitHub reports (`auto`, from See it live beside the mock-up) needs no pasted link.
 */
function PrRow({ pr, now, me, editable, busy, auto, onPreview, onRemove }: {
  pr: PullRequestLink; now: number; me: string | null; editable: boolean; busy: boolean; auto: boolean;
  onPreview: (preview: string) => Promise<string | null>; onRemove: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = async () => { const e = await onPreview(value); if (e) setError(e); else { setAdding(false); setValue(""); setError(null); } };
  return (
    <li className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <a href={pr.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline">
          <GitPullRequest aria-hidden className="size-4" />{prName(pr)}
        </a>
        <span className="text-muted-foreground">{pr.state === "merged" ? "Merged" : pr.state === "closed" ? "Closed" : "Open"}, linked {timeAgo(pr.created_at, now)}{pr.linked_by_email ? ` by ${pr.linked_by_email === me ? "you" : pr.linked_by_email}` : ""}</span>
        {pr.preview_url && <a href={pr.preview_url} target="_blank" rel="noreferrer noopener" className={quiet}><ExternalLink aria-hidden className="size-3.5" />See it live</a>}
        {editable && !pr.preview_url && !auto && !adding && <button type="button" onClick={() => setAdding(true)} disabled={busy} className={quiet}>Add a preview link</button>}
        {editable && pr.state !== "merged" && <button type="button" onClick={onRemove} disabled={busy} className={quiet}>Remove</button>}
      </div>
      {adding && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label htmlFor={`preview-${pr.id}`} className="sr-only">Preview link</label>
          <input id={`preview-${pr.id}`} autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://your-preview.vercel.app"
            className="field h-9 min-w-0 flex-1 px-2.5 text-sm outline-none" />
          <button type="submit" disabled={busy || !value.trim()} className={`${primary} btn-paper`}>Save</button>
          <button type="button" onClick={() => { setAdding(false); setError(null); }} className="h-9 px-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          {error && <p role="alert" className="w-full text-xs text-[var(--stage-failed)]">{error}</p>}
        </form>
      )}
    </li>
  );
}

/**
 * What happens after a customer approves a mock-up, in order, with who does what: hand the task to Claude Code, wait
 * for the pull request and link it (the "PMA: <id>" line will link it on its own once the GitHub App exists), add
 * its preview if there is one, then mark it shipped when it merges (owners and admins). The demo app never shows this.
 */
export function BuildPanel({ d, me, now, solutionId, solutionTitle, zip, live = null }: {
  d: IssueDetail; me: string | null; now: number;
  /** The approved proposal, which the task is built from. */
  solutionId: string | null; solutionTitle: string; zip: boolean;
  /** See it live, as the mock-up beside it read it: a preview GitHub reports counts as the Preview step. */
  live?: LiveView | null;
}) {
  const router = useRouter();
  const { role, href } = useApp();
  const p = buildProgress(d);
  const admin = role === "owner" || role === "admin";
  const mayLink = admin || (!!me && !!d.owner_email && d.owner_email === me);
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ url?: string; preview?: string; other?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const marker = `PMA: ${d.short_id}`;

  async function send(method: string, path: string, body?: object): Promise<{ ok: boolean; error?: string; field?: string }> {
    try {
      const res = await fetch(`/api/issues/${d.id}/${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const j = (await res.json().catch(() => ({}))) as { error?: string; field?: string };
      return res.ok ? { ok: true } : { ok: false, error: j.error ?? "That didn't work. Try again.", field: j.field };
    } catch { return { ok: false, error: "Couldn't reach PMA. Check your connection and try again." }; }
  }
  const link = async (f: FormState) => {
    setBusy("link"); setErrors({});
    const r = await send("POST", "pull-requests", { url: f.url, preview: f.preview });
    setBusy(null);
    if (!r.ok) { setErrors(r.field === "url" ? { url: r.error } : r.field === "preview" ? { preview: r.error } : { other: r.error }); return; }
    setLinking(false); router.refresh();
  };
  const setPreview = (pr: PullRequestLink) => async (preview: string) => {
    setBusy(`preview:${pr.id}`);
    const r = await send("PATCH", `pull-requests/${pr.id}`, { preview });
    setBusy(null);
    if (!r.ok) return r.error ?? "That didn't save.";
    router.refresh();
    return null;
  };
  const remove = (pr: PullRequestLink) => async () => {
    if (!window.confirm(`Remove the link to ${prName(pr)}? The pull request itself isn't touched.`)) return;
    setBusy(`remove:${pr.id}`); setError(null);
    const r = await send("DELETE", `pull-requests/${pr.id}`);
    setBusy(null);
    if (!r.ok) setError(r.error ?? null); else router.refresh();
  };
  const startBuild = async () => {
    setBusy("build"); setError(null);
    const mode = p.build?.mode ?? (p.mode === "branch" ? "branch" : "new_pr");
    const r = await send("POST", "build", { mode, branch: mode === "branch" ? p.build?.head_branch ?? d.project.build_branch : null });
    setBusy(null);
    if (!r.ok) setError(r.error ?? null); else router.refresh();
  };
  const ship = async () => {
    if (!window.confirm(SHIP_CONFIRM)) return;
    setBusy("ship"); setError(null);
    const r = await send("POST", "ship");
    setBusy(null);
    // Shipped meanwhile (its merge on GitHub ships it on its own): nothing went wrong, the page was behind, so show it.
    if (r.ok || r.error === SHIP_ALREADY) router.refresh(); else setError(r.error ?? null);
  };

  const linkButton = (label: string, style: "primary" | "quiet") => mayLink && !linking && (
    <button type="button" onClick={() => { setLinking(true); setErrors({}); }} disabled={busy !== null}
      className={style === "primary" ? `${primary} btn-ink sheen` : quiet}>
      {style === "primary" && <GitPullRequest aria-hidden className="size-4" />}{label}
    </button>
  );
  const form = linking && <LinkForm repo={d.project.repo_full_name} busy={busy === "link"} errors={errors} onSubmit={(f) => void link(f)} onCancel={() => setLinking(false)} />;
  // Approved to hand off, but the company's GitHub can write now: PMA can build it instead.
  const buildInstead = mayLink && d.project.build_caps.githubWrite && (
    <button type="button" onClick={() => void startBuild()} disabled={busy !== null} className={quiet}>
      {busy === "build" ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <GitPullRequest aria-hidden className="size-3.5" />}Let PMA build it instead
    </button>
  );
  const handoff = (compact: boolean) => solutionId && (
    <HandoffButton issueId={d.id} solutionId={solutionId} title={solutionTitle} zip={zip} compact={compact} hint={false}
      pull={{ short: d.short_id, connectHref: href(`/settings#${CLAUDE_CARD_ID}`) }} onHandedOff={() => router.refresh()} />
  );
  const how = p.approvedAt ? <p>Approved {timeAgo(p.approvedAt, now)}, to {BUILD_VERB[p.mode]}. Nobody who raised it has been told yet; they hear when it ships.</p> : null;
  // The explanations sit behind a toggle, so the track, the step and its button keep to one screen.
  const more = (label: string, body: React.ReactNode) => (
    <Disclosure label={label} buttonClassName="text-xs" panelClassName="space-y-1.5 pt-1.5 text-xs text-muted-foreground">{body}</Disclosure>
  );

  return (
    <section aria-label="Building it" className="w-full space-y-2 border-t border-border pt-3">
      <Track p={p} livePreview={p.pullRequests.some((pr) => pr.state === "open" && !!livePreviewOf(live, pr.number))} />
      {(p.next === "building" || p.next === "build_failed") && (
        <>
          <BuildStatus build={p.build} now={now} mayRetry={mayLink && d.project.build_caps.githubWrite} busy={busy === "build"} onRetry={() => void startBuild()} />
          {/* Claude Code stays a way to build it, whatever happens to the build. */}
          {more("Or hand it to Claude Code", <>
            <p>PMA writes the change with Claude on your company&apos;s key, commits it on a branch through the PMA GitHub App and opens the pull request. It can&apos;t run your tests, so your CI checks the pull request. Nothing merges without your review.</p>
            {how}
            <div className="pt-1">{handoff(true)}</div>
          </>)}
        </>
      )}
      {p.next === "hand_off" && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-[15px] font-medium">Next: hand it to Claude Code</p>
            {handoff(false)}
            {buildInstead}
          </div>
          {form}
          {more("What the task holds", <>
            <p>Only what Claude Code can&apos;t work out from your code: the problem in people&apos;s words, what PMA found with its file and line references, the approved change, and when it&apos;s done. Download task adds its images (today.png and proposed.png) and its layout code. Your engineers build it, and the pull request comes back here.</p>
            {/* Copy Claude Code prompt: the same task through PMA's MCP server (lib/mcp), for an engineer already in Claude Code. */}
            <p>Copy Claude Code prompt is for an engineer working in Claude Code. {PULL_TASK_NOTE} <Link href={href(`/settings#${CLAUDE_CARD_ID}`)} className="text-foreground underline-offset-4 hover:underline">Connect Claude</Link></p>
            {how}
            {mayLink && !linking && <p>{linkButton("Already have the pull request? Link it", "quiet")}</p>}
          </>)}
        </>
      )}
      {p.next === "link_pr" && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-[15px] font-medium">Waiting for the pull request</p>
            {linkButton("Link pull request", "primary")}
            {/* Copy task and Download task are actions, so they stay in view; only the explanation is folded away. */}
            {handoff(true)}
            {buildInstead}
          </div>
          {form}
          {more("How the pull request gets linked", <>
            <p>
              The task asks for the line <code className="rounded bg-foreground/[0.06] px-1 py-0.5 text-foreground/85">{marker}</code> in the pull request description. With GitHub connected, that line links the pull request here on its own, and its merge ships the issue. Otherwise paste its link{mayLink ? "" : ": an owner, an admin or the person who owns this issue can"}.
            </p>
            {how}
          </>)}
        </>
      )}
      {(p.next === "ship" || p.next === "done") && (
        <>
          {p.build?.status === "opened" && p.build.files.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Built with Claude{p.build.head_branch ? <> on <code>{p.build.head_branch}</code></> : null}: {p.build.files.length} {p.build.files.length === 1 ? "file" : "files"} changed ({p.build.files.slice(0, 3).map((f) => f.split("/").pop()).join(", ")}{p.build.files.length > 3 ? ", …" : ""}).
            </p>
          )}
          <ul className="space-y-1.5">
            {p.pullRequests.map((pr) => (
              <PrRow key={pr.id} pr={pr} now={now} me={me} editable={mayLink && !p.shipped} busy={busy !== null} auto={!!livePreviewOf(live, pr.number)} onPreview={setPreview(pr)} onRemove={() => void remove(pr)()} />
            ))}
          </ul>
          {p.next === "ship" && (admin || mayLink) && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {admin && (
                  <button type="button" onClick={() => void ship()} disabled={busy !== null} aria-describedby="ship-note"
                    className={`${primary} sheen press bg-[var(--stage-shipped)] text-white hover:brightness-110`}>
                    {busy === "ship" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}Mark as shipped
                  </button>
                )}
                {linkButton("Link another pull request", "quiet")}
              </div>
              {/* Marking it shipped tells everyone who raised it, so the warning is text under the button, not a tooltip. */}
              {admin && <p id="ship-note" className="text-xs text-muted-foreground">{d.project.build_caps.githubConnected ? "PMA marks it shipped on its own when the pull request merges on GitHub. " : ""}{SHIP_NOTE}</p>}
            </div>
          )}
          {p.next === "ship" && form}
        </>
      )}
      {error && <p role="alert" className="text-sm text-[var(--stage-failed)]">{error}</p>}
    </section>
  );
}
