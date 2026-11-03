import type { IssueDetail } from "@/lib/queries/issueDetail";
import { describeActivity } from "@/lib/queries/issueHelpers";
import { timeAgo } from "@/components/triage/format";

const QUIET = new Set(["viewed"]);

/** The issue's timeline, newest first. Views are folded away so decisions and draft events stand out. */
export function ActivityList({ d, now }: { d: IssueDetail; now: number }) {
  const items = d.activity.filter((a) => !QUIET.has(a.kind)).slice(0, 20);
  if (!items.length) return <p className="text-xs text-muted-foreground">Nothing has happened here yet.</p>;
  return (
    <ol className="space-y-2.5 border-l border-border pl-4">{items.map((a, i) => {
      const x = describeActivity(a);
      return (
        <li key={i} className="relative text-xs">
          <span aria-hidden className="absolute -left-[20px] top-1.5 size-2 rounded-full bg-card ring-2 ring-foreground/25" />
          <span className="text-foreground/90">{x.text}</span>
          {x.href && <> <a href={x.href} target="_blank" rel="noreferrer" className="underline underline-offset-2">{x.linkLabel}</a></>}
          <span className="block text-muted-foreground"><time dateTime={a.at} title={new Date(a.at).toLocaleString()}>{timeAgo(a.at, now)}</time>{a.user_email ? `, ${a.user_email}` : ""}</span>
        </li>
      );
    })}</ol>
  );
}
