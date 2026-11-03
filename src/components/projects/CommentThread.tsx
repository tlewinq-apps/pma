"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { CommentPost } from "@/lib/queries/projectHelpers";
import { COMMENT_MAX } from "@/lib/queries/projectHelpers";
import { timeAgo } from "@/components/triage/format";

const button = "inline-flex h-9 items-center gap-2 btn-ink sheen px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60";

/** One text box and its send button. Keeps the text when sending fails, so nothing typed is lost. */
function Composer({ issueId, replyTo, label, placeholder, autoFocus, onDone }: { issueId: string; replyTo: number | null; label: string; placeholder: string; autoFocus?: boolean; onDone?: () => void }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/issues/${issueId}/comments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, replyTo }) });
      if (!res.ok) { setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "That didn't send. Try again."); return; }
      setText("");
      onDone?.();
      router.refresh();
    } catch {
      setError("Couldn't reach PMA. Check your connection and try again.");
    } finally { setBusy(false); }
  }
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <textarea
        aria-label={label} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} maxLength={COMMENT_MAX} rows={2} autoFocus={autoFocus}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } if (e.key === "Escape" && onDone) onDone(); }}
        className="field block w-full resize-none px-3 py-2 text-sm outline-none [field-sizing:content] placeholder:text-muted-foreground"
      />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy || !text.trim()} className={button}>{busy && <Loader2 className="size-4 animate-spin" />}{label}</button>
        {onDone && <button type="button" onClick={onDone} className="text-sm text-muted-foreground hover:text-foreground">Cancel</button>}
        {error && <p role="alert" className="text-sm text-[var(--stage-failed)]">{error}</p>}
      </div>
    </form>
  );
}

function Post({ p, now }: { p: CommentPost; now: number }) {
  return (
    <div className="space-y-1">
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
        <span className="text-sm font-semibold text-foreground">{p.who}</span>
        {p.kind === "update" && <span className="font-semibold text-foreground/80">posted an update</span>}
        <time dateTime={p.at} title={new Date(p.at).toLocaleString()}>{timeAgo(p.at, now)}</time>
        {p.via === "slack" && <span>in Slack</span>}
      </p>
      <p className="whitespace-pre-line text-sm text-foreground/90">{p.text}</p>
    </div>
  );
}

/**
 * The project's conversation. The owner posts updates and anyone replies under them; everything here is also posted
 * to the issue's Slack thread. Replies stay one level deep.
 */
export function CommentThread({ issueId, threads, isOwner, now }: { issueId: string; threads: CommentPost[]; isOwner: boolean; now: number }) {
  const [replying, setReplying] = useState<number | null>(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-2">
        {!threads.length && <p className="text-sm text-muted-foreground">{isOwner ? "No updates yet. Post one below so the team knows where this stands." : "No updates yet."}</p>}
        {threads.map((t) => (
          <article key={t.id} className="space-y-3">
            <Post p={t} now={now} />
            {!!t.replies.length && (
              <ol className="space-y-3 border-l border-border pl-4">{t.replies.map((r) => <li key={r.id}><Post p={r} now={now} /></li>)}</ol>
            )}
            {replying === t.id
              ? <div className="pl-4"><Composer issueId={issueId} replyTo={t.id} label="Reply" placeholder={`Reply to ${t.who}`} autoFocus onDone={() => setReplying(null)} /></div>
              : <button type="button" onClick={() => setReplying(t.id)} className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Reply</button>}
          </article>
        ))}
      </div>
      <Composer
        issueId={issueId} replyTo={null} label={isOwner ? "Post update" : "Comment"}
        placeholder={isOwner ? "Where it stands, what changed and what's next" : "Add a comment for the owner and the team"}
      />
    </div>
  );
}
