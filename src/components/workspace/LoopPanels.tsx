"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, MessageCircleQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { joinNames } from "@/components/triage/format";
import type { IssueDetail } from "@/lib/queries/issueDetail";
import { Disclosure } from "@/components/ui/disclosure";
import { Section } from "./EvidencePanel";


function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button type="button" size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}>
      {done ? <Check aria-hidden /> : <Copy aria-hidden />}{done ? "Copied" : label}
    </Button>
  );
}

/** Asking the people who raised it, in their Slack threads. Shared by the full panel and the compact one. */
function useAsk(d: IssueDetail) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function ask() {
    setBusy(true);
    const r = await fetch(`/api/issues/${d.id}/followups`, { method: "POST" });
    setMsg(r.ok ? null : (await r.json()).error);
    setBusy(false);
    router.refresh();
  }
  return { busy, msg, ask };
}

const openFollowups = (d: IssueDetail) => !!d.followups?.questions.length && d.status !== "shipped" && d.status !== "dismissed";

function Questions({ d }: { d: IssueDetail }) {
  const f = d.followups!;
  const asked = f.asked ?? [];
  const toAsk = d.reporters.slack.filter((n) => !asked.includes(n));
  const { busy, msg, ask } = useAsk(d);
  return (
    <div className="space-y-3 text-sm">
      <ol className="list-decimal space-y-1 pl-5 text-[15px]">{f.questions.map((q) => <li key={q}>{q}</li>)}</ol>
      {asked.length > 0 && <p className="text-muted-foreground">Asked {joinNames(asked)} in Slack{f.asked_at ? ` on ${new Date(f.asked_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}. Their answers come back here as new feedback.</p>}
      <div className="flex flex-wrap items-center gap-2">
        {toAsk.length > 0 && <Button type="button" size="sm" disabled={busy} onClick={ask}>{busy ? "Asking…" : `Ask ${joinNames(toAsk)} in Slack`}</Button>}
        <CopyButton text={f.questions.map((q) => `- ${q}`).join("\n")} label="Copy questions" />
        {d.reporters.slack.length === 0 && <span className="text-xs text-muted-foreground">Nobody who raised this is on Slack, so copy the questions to them.</span>}
      </div>
      {msg && <p className="text-xs text-tone-negative">{msg}</p>}
    </div>
  );
}

/** Vague feedback (features, add-ons, streamline): the questions PMA drafted, and the one action that gets answers. */
export function FollowupPanel({ d }: { d: IssueDetail }) {
  if (!openFollowups(d)) return null;
  return (
    <Section title="Questions to ask" aside={<span className="flex items-center gap-1 text-xs text-muted-foreground"><MessageCircleQuestion aria-hidden className="size-3.5" />Too vague to act on yet</span>}>
      <p className="text-[15px] text-muted-foreground">What people said is too vague to fix with confidence. These questions would help:</p>
      <Questions d={d} />
    </Section>
  );
}

/** The same questions tucked beside the first step's button: asking the reporter is part of looking into it. */
export function FollowupQuestions({ d }: { d: IssueDetail }) {
  if (!openFollowups(d)) return null;
  const who = d.reporters.slack.length ? joinNames(d.reporters.slack) : "the reporter";
  return (
    <Disclosure label={`Questions for ${who}`} className="basis-full">
      <div className="pt-3"><Questions d={d} /></div>
    </Disclosure>
  );
}

/** Once shipped: who raised it, who has already been told in Slack, and a note to send everyone else. */
export function ReportersPanel({ d }: { d: IssueDetail }) {
  if (d.status !== "shipped") return null;
  const told = new Set(d.activity.filter((a) => a.kind === "reporters_told").flatMap((a) => (Array.isArray(a.payload.names) ? a.payload.names.map(String) : [])));
  const note = (name: string) => `Hi ${name}, the problem you raised ("${d.title}") is now fixed. Thank you for telling us.`;
  if (!d.reporters.slack.length && !d.reporters.others.length) return null;
  return (
    <Section title="People who raised this">
      <ul className="divide-y border-y text-sm">
        {d.reporters.slack.map((n) => (
          <li key={`s-${n}`} className="flex items-center justify-between gap-3 py-2.5">
            <span>{n} <span className="text-muted-foreground">· Slack</span></span>
            <span className={told.has(n) ? "text-xs text-tone-positive" : "text-xs text-muted-foreground"}>{told.has(n) ? "Told in their thread" : "Not told yet"}</span>
          </li>
        ))}
        {d.reporters.others.map((o) => (
          <li key={`o-${o.name}-${o.where}`} className="flex items-center justify-between gap-3 py-2.5">
            <span>{o.name} <span className="text-muted-foreground">· {o.where}</span></span>
            <CopyButton text={note(o.name)} label="Copy a note" />
          </li>
        ))}
      </ul>
    </Section>
  );
}
