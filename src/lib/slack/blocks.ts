import type { IssueType } from "@/lib/types";
import { TYPE_LABEL } from "@/components/triage/format";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function quickWinBlocks(i: { title: string; type: IssueType; importance: number; people: number; quote: string; author: string | null; flow: string | null; url: string; prUrl?: string | null }) {
  const buttons = [{ type: "button", text: { type: "plain_text", text: "Open in PMA" }, url: i.url, style: "primary" }];
  if (i.prUrl) buttons.push({ type: "button", text: { type: "plain_text", text: "Open PR" }, url: i.prUrl, style: "primary" });
  return [
    { type: "section", text: { type: "mrkdwn", text: `*Quick win:* ${esc(i.title)}\n${TYPE_LABEL[i.type]} · ${Math.round(i.people)} people · ${esc(i.flow ?? "Unmapped")}` } },
    { type: "context", elements: [{ type: "mrkdwn", text: `> ${esc(i.quote)}\n— ${esc(i.author ?? "Unknown")}` }] },
    { type: "actions", elements: buttons },
  ];
}

const isHttps = (u: string | null | undefined): u is string => {
  if (!u) return false;
  try { return new URL(u).protocol === "https:"; } catch { return false; }
};

export function draftReadyBlocks(i: { title: string; type: IssueType; importance: number; prUrl?: string | null; marverUrl?: string | null; pmaUrl?: string | null; beforeUrl?: string | null; afterUrl?: string | null }): object[] {
  const blocks: object[] = [
    { type: "section", text: { type: "mrkdwn", text: `Draft ready: *${esc(i.title)}*\n${TYPE_LABEL[i.type]}` } },
  ];
  if (isHttps(i.beforeUrl)) blocks.push({ type: "image", image_url: i.beforeUrl, alt_text: "Current" });
  if (isHttps(i.afterUrl)) blocks.push({ type: "image", image_url: i.afterUrl, alt_text: "Proposed" });
  const button = (text: string, url: string) => ({ type: "button", text: { type: "plain_text", text }, url });
  const buttons = [
    isHttps(i.prUrl) && button("Open PR", i.prUrl),
    isHttps(i.marverUrl) && button("Open in Marver", i.marverUrl),
    isHttps(i.pmaUrl) && button("Open in PMA", i.pmaUrl),
  ].filter((b): b is ReturnType<typeof button> => !!b);
  if (buttons.length) blocks.push({ type: "actions", elements: buttons });
  return blocks;
}
