"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { SlackStatus } from "@/lib/slack/setup";
import { useApp } from "@/components/app/AppContext";

const ROLE_LABEL: Record<string, string> = { inbox: "Feedback in, and the board", bug: "Bugs", new_feature: "New features", add_on: "Add-ons", streamline: "Streamline" };

export function SlackAppCard({ initial, manifest, appUrlPublic }: { initial: SlackStatus; manifest: string; appUrlPublic: boolean }) {
  const { api } = useApp();
  const [status, setStatus] = useState(initial);
  const [prefix, setPrefix] = useState("pma");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // While another app on this deployment holds Slack, the card says only that (slackStatus sends no workspace or channels).
  const connected = !status.blocked && !status.missing.length && !status.error && !!status.team;

  const create = async () => {
    setBusy(true); setMsg("Creating channels…");
    const r = await fetch(api("/slack/setup"), { method: "POST", body: JSON.stringify({ prefix }) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setMsg(j.error);
    setStatus(j);
    setMsg("Channels ready. Cards for open issues are being posted now; it takes a minute.");
  };

  return (
    <section className="space-y-3 surface p-5 text-sm">
      <h2 className="text-lg font-semibold">Slack app</h2>
      <p className="text-xs text-muted-foreground">
        Post feedback in Slack, get one card per issue in a channel per type, take issues on, and receive proposals and mockups in each card&apos;s thread.
      </p>
      {status.blocked && <p className="text-xs">{status.blocked}</p>}
      {status.missing.length > 0 && <p className="text-xs">Not connected. Add {status.missing.join(" and ")} to the environment, then restart the app.</p>}
      {status.error && <p className="text-xs">Slack refused the connection: {status.error}</p>}
      {connected && <p className="text-xs">Connected to <span className="text-foreground">{status.team}</span> as @{status.bot}.</p>}
      {!appUrlPublic && <p className="text-xs text-muted-foreground">APP_URL isn&apos;t a public https address yet, so Slack can&apos;t reach this app. Use a tunnel or your Vercel URL.</p>}
      {status.channels.length > 0 && (
        <ul className="space-y-1 text-xs">
          {status.channels.map((c) => (
            <li key={c.role} className="flex gap-2">
              {c.url ? <a href={c.url} target="_blank" rel="noreferrer" className="text-foreground underline-offset-2 hover:underline">#{c.name}</a> : <span>#{c.name}</span>}
              <span className="text-muted-foreground">{ROLE_LABEL[c.role]}</span>
            </li>
          ))}
        </ul>
      )}
      {connected && (
        <div className="flex flex-wrap items-center gap-2">
          <input value={prefix} onChange={(e) => setPrefix(e.target.value.trim().toLowerCase())} aria-label="Channel prefix" className="w-36 field px-2.5 py-1.5 outline-none" />
          <Button type="button" size="sm" onClick={create} disabled={busy}>{status.channels.length ? "Create channels again" : "Create channels"}</Button>
          <span className="text-xs text-muted-foreground">Makes #{prefix}-feedback and #{prefix}-bugs, -features, -add-ons, -streamline, or reuses them.</span>
        </div>
      )}
      {msg && <p className="text-xs">{msg}</p>}
      {!status.blocked && <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Set up the Slack app</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-muted-foreground">
          <li>On api.slack.com/apps, choose Create New App, then From a manifest, and paste the manifest below.</li>
          <li>Install it to your workspace. Copy the Bot User OAuth Token to SLACK_BOT_TOKEN and the Signing Secret to SLACK_SIGNING_SECRET, then restart.</li>
          <li>Come back here and press Create channels. Teammates who should act from Slack sign in to PMA once with their Slack email.</li>
        </ol>
        <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted p-3 font-mono text-[11px]">{manifest}</pre>
      </details>}
    </section>
  );
}
