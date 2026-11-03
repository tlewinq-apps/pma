"use client";
// A crash-reporting tool on an issue (PostHog or Sentry): the errors linked to it, with how many people hit them in 30
// days, and Link an error, which lists the app's recent errors with the likely matches first. PMA suggests; a person
// links. Shows nothing for an app without that tool.
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { DisclosureButton, DisclosurePanel } from "@/components/ui/disclosure";

import type { IssueLinkView } from "@/lib/posthog/issueView";
import type { Reach } from "@/lib/posthog/reach";

type Link = IssueLinkView;
type Suggestion = { id: string; label: string; users: number; score: number };
/** posthogIssueView's and sentryIssueView's shape. */
export type ErrorsView = { connected: false } | { connected: true; project: string | null; reach: Reach; links: IssueLinkView[] };
type State = Extract<ErrorsView, { connected: true }> & { suggestions: Suggestion[] | null };
export type ErrorTool = "posthog" | "sentry";

const TOOL: Record<ErrorTool, { name: string; reading: string; pending: string }> = {
  posthog: { name: "PostHog", reading: "Reading recent errors from PostHog.", pending: "Counted tonight" },
  sentry: { name: "Sentry", reading: "Reading this app's Sentry errors.", pending: "Counted at the next refresh" },
};

const people = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "person" : "people"}`;

/** `initial` comes from the issue page (posthogIssueView or sentryIssueView); nothing is fetched until someone links or unlinks. */
export function ErrorLinksPanel({ tool, issueId, initial }: { tool: ErrorTool; issueId: string; initial: ErrorsView | null }) {
  const t = TOOL[tool];
  const [state, setState] = useState<State | null>(initial?.connected ? { ...initial, suggestions: null } : null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const load = async (suggest = false) => {
    const r = await fetch(`/api/issues/${issueId}/${tool}${suggest ? "?suggest=1" : ""}`).catch(() => null);
    const body = r ? await r.json().catch(() => null) : null;
    if (!r?.ok) return setMsg(body?.error ?? `${t.name} couldn't be read just now.`);
    if (body?.connected) setState(body as State);
  };
  if (!state) return null;

  const link = async (s: Suggestion) => {
    setBusy(true);
    const r = await fetch(`/api/issues/${issueId}/${tool}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ external_id: s.id, title: s.label }) });
    setBusy(false);
    setMsg(r.ok ? null : ((await r.json().catch(() => ({}))) as { error?: string }).error ?? "That didn't work.");
    await load(true);
  };
  const unlink = async (l: Link) => {
    setBusy(true);
    await fetch(`/api/issues/${issueId}/${tool}?link=${l.id}`, { method: "DELETE" });
    setBusy(false);
    await load(state.suggestions !== null);
  };

  return (
    <section aria-label={t.name} className="space-y-2 text-sm">
      <h3 className="font-semibold">{t.name}</h3>
      {state.reach.users > 0 && <p>{people(state.reach.users)} hit this in the last 30 days.</p>}
      {state.links.length > 0 ? (
        <ul className="space-y-1">
          {state.links.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3">
              {l.url ? <a href={l.url} target="_blank" rel="noreferrer" title={l.title ?? l.external_id} className="link min-w-0 flex-1 truncate">{l.title ?? l.external_id}</a> : <span title={l.title ?? l.external_id} className="min-w-0 flex-1 truncate">{l.title ?? l.external_id}</span>}
              <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                {l.users !== null ? people(l.users) : t.pending}
                <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => unlink(l)}>Unlink</Button>
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="text-muted-foreground">No {t.name} error is linked to this issue yet.</p>}
      <DisclosureButton open={open} controls={panelId} onToggle={() => { if (!open && state.suggestions === null) void load(true); setOpen((o) => !o); }}>Link a {t.name} error</DisclosureButton>
      <DisclosurePanel id={panelId} open={open}>
        {state.suggestions === null ? <p className="text-muted-foreground">{t.reading}</p> : state.suggestions.length === 0 ? (
          <p className="text-muted-foreground">No errors in the last 30 days{state.project ? ` in ${state.project}` : ""}.</p>
        ) : (
          <ul className="space-y-1">
            {state.suggestions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3">
                <span title={s.label} className="min-w-0 flex-1 truncate">{s.label}{s.score > 0 && <span className="text-muted-foreground"> (likely match)</span>}</span>
                <span className="flex shrink-0 items-center gap-2 text-muted-foreground">{people(s.users)}<Button type="button" size="xs" variant="outline" disabled={busy} onClick={() => link(s)}>Link</Button></span>
              </li>
            ))}
          </ul>
        )}
      </DisclosurePanel>
      {msg && <p className="text-xs text-tone-negative">{msg}</p>}
    </section>
  );
}
