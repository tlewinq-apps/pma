"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/db/project";
import { Button } from "@/components/ui/button";
import { useApp } from "@/components/app/AppContext";
import { GithubConnect } from "@/components/github/GithubConnect";
import type { GithubFlash } from "@/components/github/flash";
import type { GithubView } from "@/lib/github/view";
import { ClaudeCard } from "./ClaudeCard";

export type SettingsView = Pick<Project, "repo_full_name" | "design_path" | "watched_branch" | "slack_webhook_url" | "widget_key" | "widget_origins" | "route_map"> & { api_key_prefix: string };

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-3 surface p-5"><h2 className="text-lg font-semibold">{title}</h2>{children}</section>;
}

/**
 * The app's repository: owners and admins connect one, through Connect with GitHub (a picker of the repositories the
 * company's PMA GitHub App installation was given, private ones too) or by typing a public owner/name, or disconnect
 * it; members see it. Connecting reads the repository on the server first, so the answer says how many source files
 * PMA can read, or why it can't.
 */
export function RepositoryCard({ repo: initialRepo, branch: initialBranch, github = null, githubFlash = null, returnTo = "" }: {
  repo: string | null; branch: string; github?: GithubView | null; githubFlash?: GithubFlash; returnTo?: string;
}) {
  const { api, role } = useApp();
  const router = useRouter();
  const canEdit = role === "owner" || role === "admin";
  const [repo, setRepo] = useState(initialRepo ? { name: initialRepo, branch: initialBranch } : null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const call = async (init: RequestInit): Promise<{ ok: boolean; body: Record<string, unknown> }> => {
    try {
      const r = await fetch(api("/repo"), init);
      return { ok: r.ok, body: await r.json().catch(() => ({ error: "Something went wrong. Try again." })) };
    } catch {
      return { ok: false, body: { error: "Couldn't reach PMA. Check your connection and try again." } };
    }
  };

  const connect = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setNote("Reading the repository. A large one takes up to a minute.");
    const { ok, body } = await call({ method: "POST", body: JSON.stringify({ repo: f.get("repo"), branch: f.get("branch") }) });
    setBusy(false);
    if (!ok) return setNote(String(body.error));
    setRepo({ name: String(body.repo), branch: String(body.ref) });
    setNote(`Connected. PMA can read ${Number(body.files).toLocaleString("en-US")} source files.`);
    router.refresh();
  };

  const disconnect = async () => {
    setBusy(true);
    const { ok, body } = await call({ method: "DELETE" });
    setBusy(false);
    if (!ok) return setNote(String(body.error));
    setRepo(null);
    setNote("Disconnected. PMA no longer reads that repository.");
    router.refresh();
  };

  return (
    <section id="repository" className="scroll-mt-6 space-y-3 surface p-5 text-sm">
      <h2 className="text-lg font-semibold">Repository</h2>
      <p className="text-xs text-muted-foreground">PMA reads the code to find where feedback points.{github?.enabled ? "" : " Public GitHub repositories connect with no token."}</p>
      {repo ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs">Connected to <code className="text-foreground">{repo.name}</code> on <code className="text-foreground">{repo.branch}</code>.</p>
          {canEdit && <Button type="button" size="sm" variant="outline" onClick={disconnect} disabled={busy}>Disconnect</Button>}
        </div>
      ) : canEdit ? (
        <div className="space-y-3">
        {github?.enabled && <GithubConnect github={github} canEdit={canEdit} returnTo={returnTo} flash={githubFlash} />}
        {github?.enabled && <p className="text-xs text-muted-foreground">Or connect a public repository by name:</p>}
        <form className="flex flex-wrap gap-2" onSubmit={connect}>
          <input name="repo" aria-label="Repository" placeholder="owner/name" required autoComplete="off" spellCheck={false} className="w-56 field px-2.5 py-1.5 outline-none" />
          <input name="branch" aria-label="Branch" placeholder="Default branch" autoComplete="off" spellCheck={false} className="w-36 field px-2.5 py-1.5 outline-none" />
          <Button type="submit" size="sm" disabled={busy}>Connect</Button>
        </form>
        </div>
      ) : (
        <p className="text-xs">No repository connected yet. A company owner or admin can connect one.</p>
      )}
      {repo && !canEdit && <p className="text-xs text-muted-foreground">Only company owners and admins can change it.</p>}
      {note && <p className="text-xs" role="status">{note}</p>}
    </section>
  );
}

/**
 * The app's settings forms. Only the demo app has the GitHub & Marver card (its repository read-only, as before, with
 * the draft-workflow note): a customer app sets the repository in its Repository card, the canvas under Connections,
 * and Slack under Connections, so it sees the Widget and Use PMA from Claude cards. The legacy Slack webhook card is the demo's, and
 * a customer app sees it only while it still has a saved webhook, so that can be cleared.
 */
export function SettingsForm({ project, appUrl, demo = false }: { project: SettingsView; appUrl: string; demo?: boolean }) {
  const { api } = useApp();
  const [msg, setMsg] = useState<string | null>(null);
  const save = async (body: object) => { const r = await fetch(api("/settings"), { method: "PATCH", body: JSON.stringify(body) }); setMsg(r.ok ? "Saved" : (await r.json()).error); };
  const sync = async () => { setMsg("Syncing…"); const r = await fetch(api("/github/sync"), { method: "POST" }); const j = await r.json(); setMsg(r.ok ? `Synced ${j.count} screens and ${j.flows ?? 0} flows from ${j.source}` : j.error); };
  const test = async () => { const r = await fetch(api("/slack/test"), { method: "POST" }); setMsg(r.ok ? "Test message sent" : (await r.json()).error); };
  return (
    <div className="space-y-4 text-sm">
      {msg && <p className="text-xs">{msg}</p>}
      {demo && <Card title="GitHub & Marver">
        <p className="text-xs text-muted-foreground">
          Repository: {project.repo_full_name ? <code className="text-foreground">{project.repo_full_name}</code> : "none connected"}.
          {" "}Connecting a repository moves to GitHub setup in a coming update.
        </p>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); save({ design_path: f.get("path"), watched_branch: f.get("branch") }); }}>
          <input name="path" aria-label="Design path" defaultValue={project.design_path} className="w-24 field px-2.5 py-1.5 outline-none" />
          <input name="branch" aria-label="Watched branch" defaultValue={project.watched_branch} className="w-24 field px-2.5 py-1.5 outline-none" />
          <Button type="submit" size="sm">Save</Button><Button type="button" size="sm" variant="outline" onClick={sync}>Sync screens now</Button>
        </form>
        <p className="text-xs text-muted-foreground">Install the draft workflow: copy <code>github-template/pma-draft.yml</code> to <code>.github/workflows/</code> in the repo and add secrets <code>ANTHROPIC_API_KEY</code>.</p>
      </Card>}
      <Card title="Widget">
        <code className="block overflow-x-auto rounded-lg bg-muted p-3 text-xs">{`<script src="${appUrl}/widget.js" data-project="${project.widget_key}" async></script>`}</code>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); let routes: unknown; try { routes = JSON.parse(String(f.get("routes")) || "{}"); } catch { setMsg("Route map must be JSON"); return; } save({ widget_origins: String(f.get("origins")).split(",").map((s) => s.trim()).filter(Boolean), route_map: routes }); }}>
          <input name="origins" defaultValue={project.widget_origins.join(", ")} placeholder="https://app.example.com" className="w-full field px-2.5 py-1.5 outline-none" />
          <textarea name="routes" defaultValue={JSON.stringify(project.route_map, null, 2)} className="h-24 w-full field p-2.5 outline-none font-mono text-xs" />
          <Button type="submit" size="sm">Save</Button>
        </form>
      </Card>
      {(demo || !!project.slack_webhook_url) && <Card title="Slack webhook (legacy)">
        <p className="text-xs text-muted-foreground">{demo
          ? "Posts quick-win alerts to one channel. Not used while the Slack app above is connected."
          : "Posts quick-win alerts to one channel. Clear the address and save to remove it; Slack under Connections replaces it."}</p>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); save({ slack_webhook_url: new FormData(e.currentTarget).get("hook") }); }}>
          <input name="hook" defaultValue={project.slack_webhook_url ?? ""} placeholder="https://hooks.slack.com/services/…" className="flex-1 field px-2.5 py-1.5 outline-none" />
          <Button type="submit" size="sm">Save</Button><Button type="button" size="sm" variant="outline" onClick={test}>Send test</Button>
        </form>
      </Card>}
      <ClaudeCard appUrl={appUrl} keyPrefix={project.api_key_prefix} />
    </div>
  );
}
