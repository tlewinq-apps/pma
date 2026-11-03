"use client";
// The Connect cards, one per tool, on Start here and in Settings > Connections: what the tool does for the company,
// its state in words (Connected, Needs attention, Not connected), and its one next step. Owners and admins connect
// and disconnect; members see the state only. Keys are typed into password fields and sent once; nothing secret ever
// comes back to the browser.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bug, FileText, Frame, KeyRound, LineChart, Loader2, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/components/app/AppContext";
import type { ToolCard, ToolKey, ToolState } from "@/lib/connections/view";

const ABOUT: Record<ToolKey, { name: string; icon: typeof KeyRound; what: string }> = {
  claude: { name: "Claude", icon: KeyRound, what: "PMA uses Claude on your own API key to read your feedback and code and to write proposals. Usage is billed to your company." },
  slack: { name: "Slack", icon: MessagesSquare, what: "Feedback posted in one channel is filed for you, and every issue gets a card in another, where your team takes it on and approves the fix." },
  marver: { name: "Marver", icon: Frame, what: "Mock-ups are drawn on your Marver design canvas, so a proposed change shows on your real screens before anyone builds it." },
  posthog: { name: "PostHog", icon: LineChart, what: "Errors and rage clicks show how many people an issue reaches, which lifts its urgency." },
  sentry: { name: "Sentry", icon: Bug, what: "Crashes linked to an issue show how many people they reached, which lifts its urgency, and what people send through Sentry's User Feedback arrives as feedback." },
  granola: { name: "Granola", icon: FileText, what: "Customer calls you take notes on in Granola arrive here as feedback, with who was in the meeting." },
};
const STATE: Record<ToolState, { label: string; tone: string }> = {
  connected: { label: "Connected", tone: "text-tone-positive" },
  attention: { label: "Needs attention", tone: "text-tone-caution" },
  off: { label: "Not connected", tone: "text-muted-foreground" },
};
const CONNECT: Record<ToolKey, string> = { claude: "Add your Claude API key", slack: "Connect to Slack", marver: "Connect to Marver", posthog: "Connect to PostHog", sentry: "Connect to Sentry", granola: "Connect to Granola" };

/** What came back from an OAuth hand-off (?connect=slack&error=taken), in words. */
export const RETURN_ERRORS: Record<string, string> = {
  taken: "That Slack workspace is already connected to another PMA company. A workspace belongs to one company.",
  enterprise: "Install PMA in one Slack workspace, not across a whole Enterprise Grid organization.",
  denied: "Nothing was connected: the sign-in was cancelled.",
  expired: "That took too long. Press Connect again.",
  wrong_user: "That sign-in was started by someone else. Press Connect again.",
  unknown: "That sign-in didn't start here. Press Connect again.",
  failed: "It didn't finish connecting. Try again in a moment.",
  not_configured: "Slack isn't set up on this deployment yet. The PMA team adds it.",
};

export type Flash = { tool: ToolKey; ok: boolean; pick?: boolean; error?: string | null } | null;

type Send = (method: string, path: string, body?: object) => Promise<{ ok: boolean; body: Record<string, unknown> }>;

function useSend(): { send: Send; busy: boolean } {
  const { api } = useApp();
  const [busy, setBusy] = useState(false);
  const send: Send = async (method, path, body) => {
    setBusy(true);
    try {
      const r = await fetch(path.startsWith("/api/") ? path : api(path), { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      return { ok: r.ok, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
    } catch {
      return { ok: false, body: { error: "Couldn't reach PMA. Check your connection and try again." } };
    } finally {
      setBusy(false);
    }
  };
  return { send, busy };
}

export function ToolCards({ cards, canEdit, returnTo, flash = null, only }: { cards: ToolCard[]; canEdit: boolean; returnTo: string; flash?: Flash; only?: ToolKey[] }) {
  const shown = only ? cards.filter((c) => only.includes(c.tool)) : cards;
  return (
    <ul className={`grid gap-3 ${shown.length > 1 ? "sm:grid-cols-2" : ""}`}>
      {shown.map((c) => <li key={c.tool} className="contents"><Card card={c} canEdit={canEdit} returnTo={returnTo} flash={flash?.tool === c.tool ? flash : null} /></li>)}
    </ul>
  );
}

function Card({ card, canEdit, returnTo, flash }: { card: ToolCard; canEdit: boolean; returnTo: string; flash: Flash }) {
  const about = ABOUT[card.tool];
  const Icon = about.icon;
  const st = STATE[card.state];
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(() =>
    flash ? (flash.ok ? { text: `${about.name} is connected.` } : flash.pick ? { text: "Signed in. Pick the project for this app below." } : { text: RETURN_ERRORS[flash.error ?? "failed"] ?? RETURN_ERRORS.failed, bad: true }) : null);
  return (
    <section aria-label={about.name} data-tool={card.tool} data-state={card.state} className="flex flex-col gap-3 rounded-[14px] bg-card p-4 shadow-paper sm:col-span-1">
      <header className="flex items-start gap-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-muted text-foreground/80"><Icon className="size-4.5" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-baseline justify-between gap-x-3 text-base font-semibold">
            {about.name}
            <span className={`text-sm font-medium ${st.tone}`}>{st.label}</span>
          </h3>
          <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{about.what}</p>
        </div>
      </header>
      {card.reason && <p className="text-sm text-tone-caution">{card.reason}</p>}
      <Body card={card} canEdit={canEdit} returnTo={returnTo} setNote={setNote} />
      {!canEdit && card.state !== "connected" && <p className="text-sm text-muted-foreground">A company owner or admin connects it.</p>}
      {note && <p role="status" className={`text-sm ${note.bad ? "text-tone-negative" : ""}`}>{note.text}</p>}
    </section>
  );
}

type BodyProps<T extends ToolCard["tool"]> = { card: Extract<ToolCard, { tool: T }>; canEdit: boolean; returnTo: string; setNote: (n: { text: string; bad?: boolean } | null) => void };

function Body({ card, ...rest }: { card: ToolCard } & Omit<BodyProps<ToolKey>, "card">) {
  switch (card.tool) {
    case "claude": return <ClaudeBody card={card} {...rest} />;
    case "slack": return <SlackBody card={card} {...rest} />;
    case "marver": return <MarverBody card={card} {...rest} />;
    case "posthog": return <PostHogBody card={card} {...rest} />;
    case "sentry": return <SentryBody card={card} {...rest} />;
    case "granola": return <GranolaBody card={card} {...rest} />;
  }
}

/** Disconnect, after a confirm. */
function Disconnect({ name, path, setNote, label = "Disconnect" }: { name: string; path: string; setNote: BodyProps<ToolKey>["setNote"]; label?: string }) {
  const router = useRouter();
  const { send, busy } = useSend();
  return (
    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={async () => {
      if (!window.confirm(`Disconnect ${name}? PMA forgets its access. You can connect it again later.`)) return;
      const r = await send("DELETE", path);
      setNote(r.ok ? { text: `${name} is disconnected.` } : { text: String(r.body.error ?? "That didn't work. Try again."), bad: true });
      router.refresh();
    }}>{label}</Button>
  );
}

/** A password field and its button: the key is sent once and the field cleared. */
function SecretForm({ label, placeholder, button, onSubmit, busy, extra }: { label: string; placeholder: string; button: string; onSubmit: (v: string) => void; busy: boolean; extra?: React.ReactNode }) {
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => {
      e.preventDefault();
      const input = e.currentTarget.elements.namedItem("secret") as HTMLInputElement;
      const v = input.value.trim();
      input.value = "";
      if (v) onSubmit(v);
    }}>
      {extra}
      <input name="secret" type="password" aria-label={label} placeholder={placeholder} autoComplete="off" spellCheck={false} required className="min-w-40 flex-1 field px-2.5 py-1.5 font-mono text-xs outline-none" />
      <Button type="submit" size="sm" disabled={busy}>{busy ? <Loader2 aria-hidden className="animate-spin" /> : null}{button}</Button>
    </form>
  );
}

function ClaudeBody({ card, canEdit, setNote }: BodyProps<"claude">) {
  const router = useRouter();
  const { send, busy } = useSend();
  const [replacing, setReplacing] = useState(false);
  const save = async (key: string) => {
    setNote({ text: "Checking the key with Anthropic." });
    const r = await send("POST", "/connections/claude", { key });
    setNote(r.ok ? { text: `Saved. PMA now uses your key ending in ${String(r.body.last4)}.` } : { text: String(r.body.error), bad: true });
    if (r.ok) { setReplacing(false); router.refresh(); }
  };
  return (
    <>
      {card.last4
        ? <p className="text-sm">Using your key ending in <code className="text-foreground">{card.last4}</code>.</p>
        : <p className="text-sm">{card.sharedFallback ? "Until you add one, PMA's own key stands in during the beta." : "Feedback isn't read until a key is added."} Make a key at console.anthropic.com, ideally in a workspace with a spend limit.</p>}
      {canEdit && (!card.last4 || replacing) && <SecretForm label="Claude API key" placeholder="sk-ant-..." button={card.last4 ? "Replace key" : CONNECT.claude} onSubmit={save} busy={busy} />}
      {canEdit && card.last4 && !replacing && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setReplacing(true)}>Replace key</Button>
          <Disconnect name="your Claude key" path="/connections/claude" setNote={setNote} label="Remove key" />
        </div>
      )}
    </>
  );
}

function SlackBody({ card, canEdit, returnTo, setNote }: BodyProps<"slack">) {
  const { appId } = useApp();
  const router = useRouter();
  const { send, busy } = useSend();
  const [mode, setMode] = useState<"create" | "pick" | null>(card.needsChannels ? "create" : null);
  const [prefix, setPrefix] = useState(card.prefix);
  const [options, setOptions] = useState<{ id: string; name: string; private: boolean }[] | null>(null);
  const connected = card.state !== "off";
  const install = `/api/slack/install?app=${appId}&return=${encodeURIComponent(returnTo)}`;

  const create = async () => {
    setNote({ text: "Creating the channels." });
    const r = await send("POST", "/slack/setup", { prefix });
    setNote(r.ok ? { text: "Channels ready. Cards for open issues are being posted now." } : { text: String(r.body.error), bad: true });
    if (r.ok) { setMode(null); router.refresh(); }
  };
  const loadChannels = async () => {
    setMode("pick");
    const r = await send("GET", "/slack/setup?channels=1");
    setOptions(r.ok ? (r.body.options as typeof options) ?? [] : []);
  };
  const pick = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await send("POST", "/slack/setup", { inbox: f.get("inbox"), cards: f.get("cards") });
    setNote(r.ok ? { text: "Channels saved. Cards for open issues are being posted now." } : { text: String(r.body.error), bad: true });
    if (r.ok) { setMode(null); router.refresh(); }
  };

  if (!connected) {
    if (!canEdit) return null;
    return card.offered
      ? <a href={install} className="inline-flex h-9 w-fit items-center gap-2 btn-ink sheen px-4 text-sm font-medium">{CONNECT.slack}</a>
      : <p className="text-sm text-muted-foreground">Slack isn&apos;t set up on this deployment yet. The PMA team adds it.</p>;
  }
  // Removed from the workspace, or its token revoked: the only way on is to connect again.
  if (!card.reachable) {
    return canEdit ? (
      <div className="flex flex-wrap gap-2">
        {card.offered && <a href={install} className="inline-flex h-9 w-fit items-center gap-2 btn-ink sheen px-4 text-sm font-medium">Connect to Slack again</a>}
        <Disconnect name="Slack" path="/connections/slack" setNote={setNote} />
      </div>
    ) : null;
  }
  return (
    <>
      {card.team && <p className="text-sm">Connected to the <span className="font-medium text-foreground">{card.team}</span> workspace.</p>}
      {card.channels.length > 0 && (
        <ul className="space-y-1 text-sm">
          {card.channels.map((c) => (
            <li key={c.role}>
              {c.url ? <a href={c.url} target="_blank" rel="noreferrer" className="link">#{c.name}</a> : <span>#{c.name}</span>}
              <span className="text-muted-foreground">{c.role === "inbox" ? ": feedback in" : c.role === "cards" ? ": issue cards and the board" : ""}</span>
            </li>
          ))}
        </ul>
      )}
      {card.error && <p className="text-sm text-tone-caution">Slack said: {card.error}</p>}
      {canEdit && mode === "create" && (
        <div className="flex flex-wrap items-center gap-2">
          <input value={prefix} onChange={(e) => setPrefix(e.target.value.trim().toLowerCase())} aria-label="Channel name start" className="w-36 field px-2.5 py-1.5 text-sm outline-none" />
          <Button type="button" size="sm" disabled={busy} onClick={create}>Create channels</Button>
          <span className="text-sm text-muted-foreground">Makes #{prefix}-feedback and #{prefix}-issues.</span>
          <Button type="button" size="sm" variant="ghost" onClick={loadChannels}>Pick existing channels</Button>
        </div>
      )}
      {canEdit && mode === "pick" && (
        options === null ? <p className="text-sm text-muted-foreground">Loading channels.</p> : (
          <form className="grid gap-2 sm:grid-cols-[auto_1fr] sm:items-center" onSubmit={pick}>
            <label htmlFor="slack-inbox" className="text-sm">Feedback channel</label>
            <select id="slack-inbox" name="inbox" required className="field px-2 py-1.5 text-sm">{options.map((o) => <option key={o.id} value={o.id}>#{o.name}{o.private ? " (private)" : ""}</option>)}</select>
            <label htmlFor="slack-cards" className="text-sm">Cards channel</label>
            <select id="slack-cards" name="cards" required className="field px-2 py-1.5 text-sm">{options.map((o) => <option key={o.id} value={o.id}>#{o.name}{o.private ? " (private)" : ""}</option>)}</select>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" size="sm" disabled={busy}>Use these channels</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setMode("create")}>Create new ones instead</Button>
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">A private channel shows here once the PMA app has been invited to it.</p>
          </form>
        )
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {mode === null && <Button type="button" size="sm" variant="outline" onClick={() => setMode("create")}>Change channels</Button>}
          <Disconnect name="Slack" path="/connections/slack" setNote={setNote} />
        </div>
      )}
    </>
  );
}

function MarverBody({ card, canEdit, setNote }: BodyProps<"marver">) {
  const router = useRouter();
  const { send, busy } = useSend();
  const [editing, setEditing] = useState(false);
  // With the app's repository connected, its design/ folder is one click; the fields are for a canvas kept elsewhere.
  const [custom, setCustom] = useState(!card.appRepo);
  const post = async (body: Record<string, unknown>) => {
    setNote({ text: "Reading the canvas. A large repository takes up to a minute." });
    const r = await send("POST", "/connections/marver", body);
    setNote(r.ok ? { text: `Connected. ${Number(r.body.screens)} screens and ${Number(r.body.flows)} flows synced.` } : { text: String(r.body.error), bad: true });
    if (r.ok) { setEditing(false); router.refresh(); }
  };
  const connect = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await post({ repo: f.get("repo") || undefined, path: f.get("path") || undefined, branch: f.get("branch") || undefined });
  };
  const sync = async () => {
    const r = await send("POST", "/github/sync");
    setNote(r.ok ? { text: `Synced ${Number(r.body.count)} screens and ${Number(r.body.flows)} flows.` } : { text: String(r.body.error), bad: true });
    router.refresh();
  };
  const form = (
    <form className="grid gap-2" onSubmit={connect}>
      <div className="flex flex-wrap gap-2">
        <input name="repo" aria-label="Repository with the canvas" placeholder={card.appRepo ?? "owner/name"} autoComplete="off" spellCheck={false} className="w-52 field px-2.5 py-1.5 text-sm outline-none" />
        <input name="path" aria-label="Canvas folder" placeholder="design" autoComplete="off" spellCheck={false} className="w-28 field px-2.5 py-1.5 text-sm outline-none" />
        <input name="branch" aria-label="Branch" placeholder="Branch" autoComplete="off" spellCheck={false} className="w-28 field px-2.5 py-1.5 text-sm outline-none" />
        <Button type="submit" size="sm" disabled={busy}>{busy ? <Loader2 aria-hidden className="animate-spin" /> : null}{CONNECT.marver}</Button>
      </div>
      <p className="text-xs text-muted-foreground">{card.appRepo ? `Leave the repository empty to use ${card.appRepo} as well, and the folder empty for design.` : "Name the repository that holds the canvas."}</p>
    </form>
  );
  const quick = card.appRepo && (
    <div className="grid gap-2">
      <Button type="button" size="sm" className="w-fit" disabled={busy} onClick={() => post({})}>
        {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}Look for a canvas in {card.appRepo}/design
      </Button>
      <p className="text-xs text-muted-foreground">
        Checks the design folder of your connected repository, where Marver keeps a canvas. <button type="button" className="link" onClick={() => setCustom(true)}>Use another repository or folder</button>.
      </p>
    </div>
  );
  if (card.state === "off" || editing) return canEdit ? (custom || !quick ? form : quick) : null;
  return (
    <>
      {/* A repository name can end in "." (acme/Closet.), so no punctuation follows it directly. */}
      {card.repo && <p className="text-sm">Reading the canvas from <code className="text-foreground">{card.repo}</code> in its <code className="text-foreground">{card.path}</code> folder{card.screens !== null ? `: ${card.screens} screens, ${card.flows ?? 0} flows.` : "."}</p>}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={sync}>Sync screens now</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>Change canvas</Button>
          <Disconnect name="Marver" path="/connections/marver" setNote={setNote} />
        </div>
      )}
    </>
  );
}

function PostHogBody({ card, canEdit, returnTo, setNote }: BodyProps<"posthog">) {
  const { appId } = useApp();
  const router = useRouter();
  const { send, busy } = useSend();
  const [region, setRegion] = useState<"us" | "eu">(card.region ?? "us");
  const [withKey, setWithKey] = useState(false);
  const signIn = `/api/posthog/oauth/start?app=${appId}&region=${region}&return=${encodeURIComponent(returnTo)}`;
  const saveKey = async (key: string) => {
    setNote({ text: "Checking the key with PostHog." });
    const r = await send("POST", "/connections/posthog", { region, key });
    setNote(r.ok ? { text: r.body.connected ? `Connected to ${String(r.body.project)}. The first numbers arrive in a minute.` : "Key saved. Pick the project for this app below." } : { text: String(r.body.error), bad: true });
    router.refresh();
  };
  const choose = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const r = await send("PATCH", "/connections/posthog", { project_id: Number(new FormData(e.currentTarget).get("project")) });
    setNote(r.ok ? { text: `Connected to ${String(r.body.project)}. The first numbers arrive in a minute.` } : { text: String(r.body.error), bad: true });
    router.refresh();
  };
  const refresh = async () => {
    const r = await send("POST", "/connections/posthog/sync");
    setNote(r.ok ? { text: "Refreshed." } : { text: String(r.body.error), bad: true });
    router.refresh();
  };
  const regionPicker = (
    <select aria-label="PostHog cloud" value={region} onChange={(e) => setRegion(e.target.value as "us" | "eu")} className="field px-2 py-1.5 text-sm">
      <option value="us">US cloud</option>
      <option value="eu">EU cloud</option>
    </select>
  );
  if (card.pick && canEdit) {
    return (
      <form className="flex flex-wrap items-center gap-2" onSubmit={choose}>
        <select name="project" aria-label="PostHog project" className="field px-2 py-1.5 text-sm">{card.pick.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <Button type="submit" size="sm" disabled={busy}>Use this project</Button>
        <Disconnect name="PostHog" path="/connections/posthog" setNote={setNote} label="Cancel" />
      </form>
    );
  }
  if (card.state === "off") {
    if (!canEdit) return null;
    return (
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {regionPicker}
          <a href={signIn} className="inline-flex h-9 items-center gap-2 btn-ink sheen px-4 text-sm font-medium">{CONNECT.posthog}</a>
          <Button type="button" size="sm" variant="ghost" onClick={() => setWithKey((v) => !v)} aria-expanded={withKey}>Use a personal API key instead</Button>
        </div>
        {withKey && <SecretForm label="PostHog personal API key" placeholder="phx_..." button="Connect with the key" onSubmit={saveKey} busy={busy} />}
        {withKey && <p className="text-xs text-muted-foreground">Make it in PostHog under Settings, Personal API keys, with read access to projects, queries and error tracking.</p>}
      </div>
    );
  }
  return (
    <>
      {card.project && <p className="text-sm">Project <span className="font-medium text-foreground">{card.project}</span> on the {card.region === "eu" ? "EU" : "US"} cloud{card.auth === "key" ? ", with a personal API key" : ""}.{card.lastSync ? ` Refreshed ${new Date(card.lastSync).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.` : " The first numbers arrive shortly."}</p>}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {card.state === "connected" && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={refresh}>Refresh now</Button>}
          {card.state === "attention" && <a href={signIn} className="inline-flex h-7 items-center btn-paper px-2.5 text-[0.8rem]">Connect again</a>}
          <Disconnect name="PostHog" path="/connections/posthog" setNote={setNote} />
        </div>
      )}
    </>
  );
}

function SentryBody({ card, canEdit, setNote }: BodyProps<"sentry">) {
  const router = useRouter();
  const { send, busy } = useSend();
  const [selfHosted, setSelfHosted] = useState(false);
  const [url, setUrl] = useState("");
  const connect = async (token: string) => {
    setNote({ text: "Checking the token with Sentry." });
    const r = await send("POST", "/connections/sentry", { token, ...(selfHosted && url.trim() ? { url: url.trim() } : {}) });
    setNote(r.ok ? { text: r.body.connected ? `Connected to ${String(r.body.project)}. The first errors and feedback arrive in a minute.` : "Token saved. Pick the project for this app below." } : { text: String(r.body.error), bad: true });
    router.refresh();
  };
  const choose = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const r = await send("PATCH", "/connections/sentry", { project: String(new FormData(e.currentTarget).get("project")) });
    setNote(r.ok ? { text: `Connected to ${String(r.body.project)}. The first errors and feedback arrive in a minute.` } : { text: String(r.body.error), bad: true });
    router.refresh();
  };
  const refresh = async () => {
    const r = await send("POST", "/connections/sentry/sync");
    setNote(r.ok ? { text: Number(r.body.queued) ? `Refreshed. ${String(r.body.queued)} new feedback ${Number(r.body.queued) === 1 ? "is" : "are"} being read.` : "Refreshed." } : { text: String(r.body.error), bad: true });
    router.refresh();
  };
  const tokenForm = (button: string) => (
    <div className="grid gap-2">
      <SecretForm label="Sentry personal token" placeholder="sntryu_..." button={button} onSubmit={connect} busy={busy} />
      <p className="text-xs text-muted-foreground">Make it in Sentry under User settings, Personal Tokens, with the org:read, project:read and event:read scopes.</p>
      <Button type="button" size="sm" variant="ghost" className="justify-self-start" onClick={() => setSelfHosted((v) => !v)} aria-expanded={selfHosted}>Self-hosted Sentry?</Button>
      {selfHosted && <input value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Self-hosted Sentry address" placeholder="https://sentry.example.com" spellCheck={false} className="field px-2.5 py-1.5 text-sm outline-none" />}
    </div>
  );
  if (card.pick && canEdit) {
    return (
      <form className="flex flex-wrap items-center gap-2" onSubmit={choose}>
        <select name="project" aria-label="Sentry project" className="field px-2 py-1.5 text-sm">{card.pick.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
        <Button type="submit" size="sm" disabled={busy}>Use this project</Button>
        <Disconnect name="Sentry" path="/connections/sentry" setNote={setNote} label="Cancel" />
      </form>
    );
  }
  if (card.state === "off") return canEdit ? tokenForm(CONNECT.sentry) : null;
  return (
    <>
      {card.project && <p className="text-sm">Project <span className="font-medium text-foreground">{card.project}</span>{card.org ? ` in ${card.org}` : ""}{card.selfHosted ? ", on your own Sentry" : ""}.{card.lastSync ? ` Refreshed ${new Date(card.lastSync).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.` : ""}</p>}
      {canEdit && card.state === "attention" && tokenForm("Connect again")}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {card.state === "connected" && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={refresh}>Refresh now</Button>}
          <Disconnect name="Sentry" path="/connections/sentry" setNote={setNote} />
        </div>
      )}
    </>
  );
}

function GranolaBody({ card, canEdit, setNote }: BodyProps<"granola">) {
  const router = useRouter();
  const { send, busy } = useSend();
  const [replacing, setReplacing] = useState(false);
  const save = async (key: string) => {
    setNote({ text: "Checking the key with Granola." });
    const r = await send("POST", "/connections/granola", { key });
    setNote(r.ok ? { text: r.body.webhook ? "Connected. New notes arrive within a minute; the last four days are coming in now." : "Connected. Notes arrive each night; the last four days are coming in now." } : { text: String(r.body.error), bad: true });
    if (r.ok) { setReplacing(false); router.refresh(); }
  };
  const here = async () => {
    const r = await send("PATCH", "/connections/granola", {});
    setNote(r.ok ? { text: "New notes now come to this app." } : { text: String(r.body.error), bad: true });
    router.refresh();
  };
  const check = async () => {
    const r = await send("POST", "/connections/granola/sync");
    setNote(r.ok ? { text: Number(r.body.queued) ? `${Number(r.body.queued)} new notes are being read.` : "No new notes." } : { text: String(r.body.error), bad: true });
    router.refresh();
  };
  if (card.state === "off" || replacing) {
    if (!canEdit) return null;
    return (
      <>
        <SecretForm label="Granola API key" placeholder="grn_..." button={replacing ? "Replace key" : CONNECT.granola} onSubmit={save} busy={busy} />
        <p className="text-xs text-muted-foreground">
          In the Granola desktop app: Settings, Connectors, API keys, then Create new key. A workspace key (made by a workspace admin) brings in every shared note; a personal key brings yours. Needs Granola&apos;s Business plan. <a href="https://docs.granola.ai/introduction" target="_blank" rel="noreferrer" className="link">Granola&apos;s guide</a>
        </p>
      </>
    );
  }
  return (
    <>
      <p className="text-sm">
        Key ending in <code className="text-foreground">{card.last4}</code>. {card.webhook ? "New notes arrive within a minute." : "New notes arrive each night."}
        {!card.here && card.target ? <> Notes go to <span className="font-medium text-foreground">{card.target}</span>.</> : null}
      </p>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {!card.here && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={here}>Send notes to this app</Button>}
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={check}>Check for new notes</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setReplacing(true)}>Replace key</Button>
          <Disconnect name="Granola" path="/connections/granola" setNote={setNote} />
        </div>
      )}
    </>
  );
}
