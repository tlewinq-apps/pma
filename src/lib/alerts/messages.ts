// Slack messages for alerts and the daily digest. Pure and emoji-free, built from the shared Slack kit.
import type { IssueType } from "@/lib/types";
import { SEVERITY_LABEL, TYPE_LABEL, joinNames, peopleLabel, reachLabel } from "@/components/triage/format";
import { ACTION, ref } from "@/lib/slack/ids";
import { actions, clip, context, divider, esc, linkButton, mlink, primary, quoteLines, section, slackDate } from "@/lib/slack/kit";
import { checkOf } from "@/lib/diagnosis/checks";
import type { AlertRule } from "./rules";

const HEAD: Record<AlertRule, string> = { blocking_bug: "New bug that blocks people", jump: "Rising fast since yesterday" };
/** A known bug that has just started blocking people reads differently from a brand-new one. */
const head = (rule: AlertRule, detail: Record<string, unknown>) => (rule === "blocking_bug" && detail.new === false ? "This bug now blocks people" : HEAD[rule]);

export type AlertView = {
  issueId: string; title: string; type: IssueType; url: string; importance: number; severity: number; people: number; reach: number;
  quote: { text: string; author: string | null } | null; rule: AlertRule; detail: Record<string, unknown>; reason?: string | null;
  /** Still waiting on its first step: the one action is that step (Run diagnostics on a bug). */
  diagnose?: boolean;
  /** How many people raised it, in a customer app's audience words ("1 shopper"). The demo sets none and keeps "1 person". */
  peopleText?: string;
};

/** The DM: what happened, why it matters (impact, people, reach), the strongest quote, and what to do next. */
export function alertMessage(a: AlertView): { text: string; blocks: object[] } {
  const blocks: object[] = [
    section(`*${head(a.rule, a.detail)}:* ${mlink(a.url, a.title)}`),
    context([SEVERITY_LABEL[a.severity], a.peopleText ?? peopleLabel(a.people), reachLabel(a.reach)].filter(Boolean).join("  ·  ")),
  ];
  if (a.rule === "jump" && a.reason) blocks.push(section(`${esc(a.reason.charAt(0).toUpperCase() + a.reason.slice(1)).replace(/\.?$/, ".")}`));
  if (a.quote) blocks.push(section(`${quoteLines(esc(clip(a.quote.text, 500)))}${a.quote.author ? `\n${esc(a.quote.author)}` : ""}`));
  blocks.push(actions([a.diagnose && primary(checkOf(a.type).button, ACTION.diagnose, { value: ref(a.issueId) }), linkButton("Open in PMA", a.url, "app")]));
  return { text: `${head(a.rule, a.detail)}: ${a.title}`, blocks };
}

/** The `alert` activity as one line in the issue's card thread (broadcast to the channel). */
export function alertThreadText(p: Record<string, unknown>): string {
  const sent = Array.isArray(p.sent_to) && p.sent_to.length ? ` Sent to ${joinNames(p.sent_to)}.` : "";
  if (p.rule === "jump") return `${HEAD.jump}.${sent}`;
  return `${head("blocking_bug", p)}.${sent}`;
}

export type DigestIssue = {
  id: string; title: string; type: IssueType; importance: number | null; status: string; owner: string | null; createdAt: string; updatedAt: string; link: string;
};
export type Digest = { top: DigestIssue[]; fresh: DigestIssue[]; shipped: DigestIssue[] };

const WEEK_MS = 7 * 86_400_000;
const isOpen = (i: DigestIssue) => i.status !== "shipped" && i.status !== "dismissed";
const byPriority = (a: DigestIssue, b: DigestIssue) => (b.importance ?? -1) - (a.importance ?? -1);

export function buildDigest(issues: DigestIssue[], now: number): Digest {
  const open = issues.filter(isOpen).sort(byPriority);
  return {
    top: open.slice(0, 5),
    fresh: open.filter((i) => now - Date.parse(i.createdAt) <= WEEK_MS),
    shipped: issues.filter((i) => i.status === "shipped" && now - Date.parse(i.updatedAt) <= WEEK_MS).sort(byPriority),
  };
}

const line = (i: DigestIssue, withOwner: boolean) =>
  `• ${mlink(i.link, i.title)}  ·  ${TYPE_LABEL[i.type]}${withOwner ? `  ·  ${i.owner ? `Taken on by ${esc(i.owner)}` : "Nobody on it yet"}` : ""}`;
const group = (label: string, items: DigestIssue[], empty: string, withOwner: boolean, max = 5) =>
  section(`*${label}*${items.length ? `  ${items.length}` : ""}\n${items.length ? items.slice(0, max).map((i) => line(i, withOwner)).join("\n") : empty}`);

export function digestMessage(d: Digest, appUrl: string, now: number): { text: string; blocks: object[] } {
  return {
    text: "Today in PMA",
    blocks: [
      section(`*Today in PMA*\nWhat matters most right now. ${mlink(appUrl, "Open PMA")}`),
      context(slackDate(now)),
      divider(),
      section(`*Highest priority*\n${d.top.length ? d.top.map((i) => line(i, true)).join("\n") : "Nothing open"}`),
      group("New this week", d.fresh, "Nothing new", false, 3),
      group("Shipped this week", d.shipped, "Nothing shipped yet", false),
    ],
  };
}
