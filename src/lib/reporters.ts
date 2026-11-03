// Closing the loop with the people who raised an issue. Pure: who can be answered in their original Slack thread,
// who can't (and so is listed by name), and what the replies say.
import { esc, mlink } from "@/lib/slack/kit";

export type ReporterRow = { source_id: string; kind: string; author: string | null; channel: string | null; metadata: unknown };
export type SlackReporter = { sourceId: string; channel: string; ts: string; user: string; name: string };

type SlackMeta = { channel?: string; ts?: string; user?: string; reply_to?: string };
const slackMeta = (r: ReporterRow) => (r.metadata as { slack?: SlackMeta } | null)?.slack;

/**
 * One Slack reporter per person per thread: an answer to a follow-up (`reply_to`) folds into the message that started
 * the thread, and replies always go to that parent thread.
 */
export function reportersToTell(rows: ReporterRow[]): { slack: SlackReporter[]; others: { name: string; where: string }[] } {
  const slack = new Map<string, SlackReporter>();
  const others = new Map<string, { name: string; where: string }>();
  // Messages that started a thread first, so they win over answers inside it.
  for (const r of [...rows].sort((a, b) => Number(!!slackMeta(a)?.reply_to) - Number(!!slackMeta(b)?.reply_to))) {
    const s = slackMeta(r);
    if (r.kind === "slack" && s?.channel && s.ts && s.user) {
      const thread = s.reply_to ?? s.ts;
      const key = `${s.channel}:${thread}:${s.user}`;
      if (!slack.has(key)) slack.set(key, { sourceId: r.source_id, channel: s.channel, ts: thread, user: s.user, name: r.author ?? "someone" });
      continue;
    }
    const name = r.author ?? "Someone";
    const where = r.kind === "slack" ? "Slack" : r.channel ?? r.kind;
    if (!others.has(`${name}\0${where}`)) others.set(`${name}\0${where}`, { name, where });
  }
  return { slack: [...slack.values()], others: [...others.values()] };
}

export const shippedReplyText = (user: string, title: string, url: string) =>
  `<@${user}> This is fixed: ${mlink(url, title)}. Thanks for raising it.`;

export const followupAskText = (user: string, questions: string[]) =>
  `<@${user}> A quick follow-up on what you raised:\n${questions.map((q) => `• ${esc(q)}`).join("\n")}\nReply in this thread and it goes straight back to the team.`;
