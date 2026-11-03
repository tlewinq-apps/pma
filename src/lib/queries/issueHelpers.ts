// Pure helpers shared by the server query and the (client) workspace. No server imports here.
import { LANE_LABEL, joinNames } from "@/components/triage/format";
import type { Lane } from "@/lib/types";
import { checkOf } from "@/lib/diagnosis/checks";
import { friendlyLlmError } from "@/lib/llm/errors";

export type DetailQuote = {
  id: string; quote: string; sentiment?: number; speakers: string[]; source_id: string; author: string | null; channel: string | null; at: string;
  /** What the classifier read in it (Why it matters). */
  emotion?: string | null; audience?: string | null; signals?: Record<string, boolean> | null;
  /** Who else was named, and how many more they said they spoke for (urgency's people count). */
  corroborators?: string[]; reportedCount?: number;
};
export type QuoteGroup = { source_id: string; author: string | null; channel: string | null; at: string; quotes: DetailQuote[] };

export function groupQuotesBySource(quotes: DetailQuote[]): QuoteGroup[] {
  const groups = new Map<string, QuoteGroup>();
  for (const q of quotes) {
    const g = groups.get(q.source_id);
    if (g) g.quotes.push(q);
    else groups.set(q.source_id, { source_id: q.source_id, author: q.author, channel: q.channel, at: q.at, quotes: [q] });
  }
  return [...groups.values()];
}

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Who said this quote, when that isn't the person who added the source (one recording or thread, several voices). */
export function quoteSpeaker(q: DetailQuote): string | null {
  const people = q.speakers.filter((p) => p.trim());
  if (!people.length || (people.length === 1 && same(people[0], q.author))) return null;
  return people.join(", ");
}

/** "Jordan in Support call", or just "Member community call" when the quotes in it come from other people. */
export function sourceHeading(g: Pick<QuoteGroup, "author" | "channel" | "quotes">): string {
  const where = g.channel ?? "an upload";
  return g.quotes.some((q) => quoteSpeaker(q)) ? where : `${g.author ?? "Unknown"} in ${where}`;
}

export function marverBranchUrl(repo: string | null | undefined, branch: string | null | undefined, designPath: string | null | undefined): string | null {
  if (!repo || !branch || !designPath) return null;
  return `https://github.com/${repo}/tree/${branch}/${designPath.replace(/^\/+/, "")}`;
}

const str = (v: unknown) => (v == null ? "" : String(v));
const clip = (v: unknown, n = 120) => { const t = str(v); return t.length > n ? `${t.slice(0, n)}…` : t; };
/** A stored failure in plain words: older rows hold the API's raw error text. */
const failure = (e: unknown) => (typeof e === "string" && e.trim() ? friendlyLlmError(e) : null);
const withDetail = (label: string, detail: unknown) => { const t = clip(detail); return t ? `${label}: ${t}` : label; };

const laneWord = (v: unknown) => LANE_LABEL[v as Lane] ?? str(v);
const lower = (v: unknown) => { const t = str(v); return t.charAt(0).toLowerCase() + t.slice(1); };

const httpsGithub = (v: unknown) => typeof v === "string" && v.startsWith("https://github.com/");
const httpsUrl = (v: unknown) => typeof v === "string" && v.startsWith("https://");

export function describeActivity(a: { kind: string; payload?: Record<string, unknown> | null }): { text: string; href?: string; linkLabel?: string } {
  const p = a.payload ?? {};
  switch (a.kind) {
    case "decision": return { text: `decision: ${clip(p.text)}` };
    case "relabeled": return { text: `re-labelled ${str(p.from)} → ${str(p.to)}` };
    case "retitled": return { text: "renamed" };
    case "lane_changed": return { text: p.from ? `moved from ${laneWord(p.from)} to ${laneWord(p.to)}` : `sorted into ${laneWord(p.to)}` };
    case "alert": {
      const sent = Array.isArray(p.sent_to) && p.sent_to.length ? `, sent to ${joinNames(p.sent_to)}` : "";
      const failed = Array.isArray(p.failed) ? (p.failed as { error?: string }[]) : [];
      // A missing DM permission is the usual cause, and the fix is the user's: say what to do.
      const why = failed.some((f) => /missing_scope/.test(str(f.error))) ? "reinstall the Slack app to allow direct messages" : [...new Set(failed.map((f) => str(f.error)))].join(", ");
      const fail = failed.length ? `; ${failed.length} Slack ${failed.length === 1 ? "message" : "messages"} couldn't be sent (${why})` : "";
      const head = p.rule === "jump" ? "alert: rising fast since yesterday" : p.new === false ? "alert: this bug now blocks people" : "alert: new bug that blocks people";
      return { text: `${head}${sent}${fail}` };
    }
    case "diagnosis_started": return { text: `${checkOf(str(p.type) || "bug").started}${p.screen ? ` on ${str(p.screen)}` : ""}${p.via === "slack" ? " from Slack" : ""}` };
    case "diagnosis_ready": return { text: withDetail(checkOf(str(p.type) || "bug").done.replace(/\.$/, "").toLowerCase(), p.headline ?? p.cause) };
    case "diagnosis_failed": return { text: withDetail(`${checkOf(str(p.type) || "bug").button.toLowerCase()} didn't finish`, failure(p.error)) };
    case "reporters_told": return { text: `told ${joinNames(p.names)} in Slack that it shipped` };
    case "followups_drafted": return { text: "drafted follow-up questions" };
    case "followups_asked": return { text: `asked ${joinNames(p.names)} follow-up questions in Slack` };
    case "followup_answered": return { text: `${str(p.name) || "Someone"} answered: ${clip(p.quote)}${Array.isArray(p.filed) && p.filed.length ? ` (filed under ${joinNames(p.filed)})` : ""}` };
    case "priority_changed": return { text: p.from == null ? "first rated" : `${Number(p.to) >= Number(p.from) ? "rose" : "fell"} in priority${p.reason ? `: ${lower(p.reason)}` : ""}` };
    case "assigned": return { text: p.to === "me" ? "assigned to me" : "unassigned" };
    case "pr_event": return { text: `PR ${str(p.action)}${p.by ? ` by ${str(p.by)}` : ""}` };
    case "draft_dispatched": return { text: `${p.demo ? "demo draft started" : p.approximate ? "started an approximate mock-up" : p.mock ? "mock runner started a draft" : "draft dispatched"}${p.solution ? `: ${str(p.solution)}` : ""}` };
    // An approximate mock-up (drawn from a customer app's code) has no pull request or run log to link to.
    case "draft_failed": if (p.approximate) return { text: withDetail("mock-up didn't finish", failure(p.error)) };
      return typeof p.log_url === "string" && p.log_url ? { text: "draft failed", href: p.log_url, linkLabel: "log" } : { text: "draft failed" };
    case "draft_ready": if (p.demo) return { text: "demo draft ready" };
      if (p.approximate) return { text: "approximate mock-up ready" };
      return typeof p.pr_url === "string" && p.pr_url.startsWith("https://") ? { text: "draft ready", href: p.pr_url, linkLabel: "PR" } : { text: "draft ready" };
    case "draft_skipped": return { text: withDetail("draft skipped", p.reason) };
    case "flow_requested": return { text: `asked for the full ${p.flow ? `${str(p.flow)} ` : ""}flow${p.via === "slack" ? " from Slack" : ""}` };
    case "flow_ready": return { text: withDetail("full flow drawn", p.summary) };
    case "flow_failed": return { text: withDetail("full flow didn't finish", failure(p.error)) };
    case "lane_action_failed": return { text: withDetail("lane action failed", failure(p.error)) };
    case "slack_failed": return { text: withDetail("Slack failed", p.error) };
    case "dismissed": return { text: "dismissed" };
    case "approved": if (p.demo) return { text: "approved and merged (demo)" };
      if (p.approximate) return { text: p.build === "claude_code" ? "approved the mock-up, to hand off to Claude Code" : "approved the mock-up" };
      if (p.mock) return { text: "approved and merged (mock runner)" };
      return typeof p.pr_url === "string" && p.pr_url.startsWith("https://") ? { text: "approved and merged", href: p.pr_url, linkLabel: "PR" } : { text: "approved and merged" };
    case "changes_requested": return { text: withDetail("requested changes", p.note) };
    // After an approved mock-up: the hand-off, the pull request that builds it, its preview, and shipping it by hand.
    case "handed_off": return { text: p.via === "download" ? "downloaded the task for Claude Code, with the mock-up images" : "copied the task for Claude Code" };
    case "pr_linked": return { text: p.via === "marker" ? `pull request #${str(p.pr_number)} linked itself with its PMA line` : `linked pull request #${str(p.pr_number)}`, ...(httpsGithub(p.pr_url) ? { href: str(p.pr_url), linkLabel: "PR" } : {}) };
    case "build_opened": return { text: `built it with Claude and opened pull request #${str(p.pr_number)}`, ...(httpsGithub(p.pr_url) ? { href: str(p.pr_url), linkLabel: "PR" } : {}) };
    case "pr_unlinked": return { text: `removed the link to pull request #${str(p.pr_number)}` };
    case "preview_added": return { text: `added a preview of pull request #${str(p.pr_number)}`, ...(httpsUrl(p.preview_url) ? { href: str(p.preview_url), linkLabel: "preview" } : {}) };
    case "preview_removed": return { text: `removed the preview of pull request #${str(p.pr_number)}` };
    case "shipped": return { text: p.manual ? `marked it shipped${p.pr_number ? ` (pull request #${str(p.pr_number)})` : ""}` : p.via === "github" ? `shipped: pull request #${str(p.pr_number)} merged` : "shipped", ...(httpsGithub(p.pr_url) ? { href: str(p.pr_url), linkLabel: "PR" } : {}) };
    case "proposal_added": return { text: withDetail("added a proposal", p.title) };
    case "proposal_edited": return { text: withDetail("edited proposal", p.title) };
    case "proposal_restored": return { text: withDetail("restored PMA's version", p.title) };
    case "proposal_removed": return { text: withDetail("removed proposal", p.title) };
    case "slack_sent": return { text: "sent to Slack" };
    case "feedback_added": return { text: withDetail(p.created ? (p.author ? `reported by ${str(p.author)}` : "reported") : p.author ? `new feedback from ${str(p.author)}` : "new feedback", p.quote) };
    case "commented": return { text: withDetail(p.source === "slack" ? `${str(p.name) || "someone"} in Slack` : "commented", p.text) };
    case "viewed": return { text: "viewed" };
    default: return { text: a.kind.replace(/_/g, " ") };
  }
}
