"use client";
// Connect with GitHub, then pick the repository. Before the company has an installation it's one button to GitHub's
// install page; after, a picker of the repositories the installation was given (private ones too), saved through the
// same POST /repo as a typed public repository, so PMA reads it before it's kept.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/components/app/AppContext";
import type { GithubView } from "@/lib/github/view";
import type { GithubFlash } from "./flash";

type Repo = { full_name: string; private: boolean; default_branch: string };

export function GithubConnect({ github, canEdit, returnTo, flash = null }: { github: GithubView; canEdit: boolean; returnTo: string; flash?: GithubFlash }) {
  const { api, appId } = useApp();
  const router = useRouter();
  const install = `/api/github/install?app=${appId}&return=${encodeURIComponent(returnTo)}`;
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(flash ? { text: flash.text, bad: !flash.ok } : null);

  useEffect(() => {
    if (!github.connected || !canEdit) return;
    let live = true;
    fetch(api("/github/repos")).then(async (r) => {
      const j = (await r.json().catch(() => ({}))) as { repos?: Repo[]; error?: string };
      if (!live) return;
      if (!r.ok) { setRepos([]); setNote({ text: j.error ?? "Couldn't list your repositories. Try again.", bad: true }); return; }
      setRepos(j.repos ?? []);
      setPick(j.repos?.[0]?.full_name ?? "");
    }, () => { if (live) { setRepos([]); setNote({ text: "Couldn't reach PMA. Check your connection and try again.", bad: true }); } });
    return () => { live = false; };
  }, [api, github.connected, canEdit]);

  if (!github.enabled || !canEdit) return null;

  if (!github.connected) {
    return (
      <div className="space-y-2">
        <a href={install} className="inline-flex h-10 w-fit items-center gap-2 btn-ink sheen px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60">Connect with GitHub</a>
        <p className="text-sm text-muted-foreground">Install the PMA app on GitHub and choose the repositories it may read, private ones included. Then pick one here.</p>
        {github.reason && <p className="text-sm text-tone-caution">{github.reason}</p>}
        {note && <p role="status" className={`text-sm ${note.bad ? "text-tone-negative" : ""}`}>{note.text}</p>}
      </div>
    );
  }

  const chosen = repos?.find((r) => r.full_name === pick) ?? null;
  const connect = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const branch = String(new FormData(e.currentTarget).get("branch") ?? "").trim();
    setBusy(true);
    setNote({ text: "Reading the repository. A large one takes up to a minute." });
    try {
      const r = await fetch(api("/repo"), { method: "POST", body: JSON.stringify({ repo: pick, branch: branch || undefined }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string; files?: number };
      setNote(r.ok ? { text: `Connected. PMA can read ${Number(j.files ?? 0).toLocaleString("en-US")} source files.` } : { text: j.error ?? "Couldn't connect it. Try again.", bad: true });
      if (r.ok) router.refresh();
    } catch {
      setNote({ text: "Couldn't reach PMA. Check your connection and try again.", bad: true });
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    if (!window.confirm("Disconnect GitHub? PMA stops reading private repositories through it. The app stays installed on GitHub until you remove it there.")) return;
    const r = await fetch(api("/connections/github"), { method: "DELETE" });
    setNote(r.ok ? { text: "GitHub is disconnected." } : { text: "Couldn't disconnect GitHub. Try again.", bad: true });
    router.refresh();
  };

  return (
    <div className="space-y-2">
      {/* An account name can end in "." in principle, so no full stop follows it directly. */}
      <p className="text-sm">GitHub is connected{github.account ? <> through <code className="text-foreground">{github.account}</code></> : ""}. Missing a repository? <a href={install} className="link">Give the PMA app access on GitHub</a>.</p>
      {github.reason && <p className="text-sm text-tone-caution">{github.reason}</p>}
      {repos === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden className="size-4 animate-spin" />Listing your repositories.</p>
      ) : repos.length ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={connect}>
          <select aria-label="Repository" value={pick} onChange={(e) => setPick(e.target.value)} className="field max-w-full px-2.5 py-1.5 text-sm outline-none">
            {repos.map((r) => <option key={r.full_name} value={r.full_name}>{r.full_name}{r.private ? " (private)" : ""}</option>)}
          </select>
          <input name="branch" aria-label="Branch" placeholder={chosen?.default_branch ?? "Default branch"} autoComplete="off" spellCheck={false} className="w-36 field px-2.5 py-1.5 text-sm outline-none" />
          <Button type="submit" size="sm" disabled={busy || !pick}>{busy ? <Loader2 aria-hidden className="animate-spin" /> : null}Connect repository</Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">The PMA app can&apos;t see any repositories yet. <a href={install} className="link">Choose some on GitHub</a>.</p>
      )}
      <Button type="button" size="sm" variant="ghost" onClick={disconnect}>Disconnect GitHub</Button>
      {note && <p role="status" className={`text-sm ${note.bad ? "text-tone-negative" : ""}`}>{note.text}</p>}
    </div>
  );
}
