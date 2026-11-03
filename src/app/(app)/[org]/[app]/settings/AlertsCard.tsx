"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { parseAlertRules, type AlertRules } from "@/lib/alerts/rules";
import { useApp } from "@/components/app/AppContext";

export type AlertMember = { userId: string; email: string; slack: "matched" | "missing" | null };

/**
 * Who hears about which issues, in Slack. The issue's owner is always told; these people are told about every alert.
 * `initial` is read through parseAlertRules, so an app with no saved rule (or a partial one) shows the defaults,
 * such as the 15 points of a sudden jump, rather than an empty field. A customer app connects Slack under
 * Connections; the demo has its own Slack app card above.
 */
export function AlertsCard({ initial, members, slackLive, inboxChannel, customer = false }: { initial: AlertRules; members: AlertMember[]; slackLive: boolean; inboxChannel: string | null; customer?: boolean }) {
  const { api } = useApp();
  const [rules, setRules] = useState(() => parseAlertRules(initial));
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (userId: string) => setRules((r) => ({ ...r, recipients: r.recipients.includes(userId) ? r.recipients.filter((u) => u !== userId) : [...r.recipients, userId] }));

  async function save() {
    setBusy(true);
    const r = await fetch(api("/settings"), { method: "PATCH", body: JSON.stringify({ alert_rules: rules }) });
    setMsg(r.ok ? "Saved" : (await r.json()).error);
    setBusy(false);
  }
  async function digestNow() {
    setBusy(true);
    setMsg("Sending…");
    const r = await fetch(api("/alerts/digest"), { method: "POST" });
    setMsg(r.ok ? `Digest posted${inboxChannel ? ` in #${inboxChannel}` : ""}` : (await r.json()).error);
    setBusy(false);
  }

  return (
    <section className="space-y-4 surface p-5 text-sm">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Alerts</h2>
        <p className="text-muted-foreground">PMA sends a Slack message to whoever has taken an issue on and to the people below, and notes it in the issue&apos;s thread.{!slackLive && ` ${customer ? "Connect Slack under Connections" : "Set up the Slack app above"} to send them; until then alerts only show in each issue's activity.`}</p>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="mb-1 font-medium">Who gets every alert</legend>
        {members.length === 0 && <p className="text-muted-foreground">No members yet.</p>}
        {members.map((m) => (
          <label key={m.userId} className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-[var(--brand-strong)]" checked={rules.recipients.includes(m.userId)} onChange={() => toggle(m.userId)} />
            <span>{m.email}</span>
            {m.slack && <span className={m.slack === "matched" ? "text-xs text-tone-positive" : "text-xs text-muted-foreground"}>{m.slack === "matched" ? "Matched in Slack" : "No Slack account with this email"}</span>}
          </label>
        ))}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-1 font-medium">When to alert</legend>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1 size-4 accent-[var(--brand-strong)]" checked={rules.blockingBug} onChange={(e) => setRules({ ...rules, blockingBug: e.target.checked })} />
          <span>A new bug that blocks the task<span className="block text-xs text-muted-foreground">Someone says it stops them finishing what they were doing, even if few people have reported it yet.</span></span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1 size-4 accent-[var(--brand-strong)]" checked={rules.jump.enabled} onChange={(e) => setRules({ ...rules, jump: { ...rules.jump, enabled: e.target.checked } })} />
          <span>
            A sudden jump: priority rises{" "}
            <input type="number" min={1} max={100} aria-label="Points" value={rules.jump.points} onChange={(e) => setRules({ ...rules, jump: { ...rules.jump, points: Number(e.target.value) || 1 } })} className="w-14 rounded border border-input bg-transparent px-1.5 py-0.5 tabular-nums" />
            {" "}points or more in a day
            <span className="block text-xs text-muted-foreground">Usually several new reports at once, or people saying it got worse.</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1 size-4 accent-[var(--brand-strong)]" checked={rules.digest.enabled} onChange={(e) => setRules({ ...rules, digest: { enabled: e.target.checked } })} />
          <span>A daily digest at 9:00 (US Eastern){inboxChannel ? ` in #${inboxChannel}` : ""}<span className="block text-xs text-muted-foreground">The five highest-priority open issues, what&apos;s new this week, and what shipped.</span></span>
        </label>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={save}>Save alerts</Button>
        <Button type="button" size="sm" variant="outline" disabled={busy || !slackLive} onClick={digestNow}>Send digest now</Button>
        {msg && <span className="text-xs">{msg}</span>}
      </div>
    </section>
  );
}
