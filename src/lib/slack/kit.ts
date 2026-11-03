// Block Kit helpers. Pure. Every user string goes through esc() (or plain_text) before it reaches Slack. No emoji;
// the only button style is "primary", on the one next step a message asks for, so each message has one obvious move.
import { esc } from "./blocks";
import { LINK_PREFIX } from "./ids";

export { esc };

export const isHttps = (u: string | null | undefined): u is string => {
  if (!u) return false;
  try { return new URL(u).protocol === "https:"; } catch { return false; }
};
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** A mrkdwn link whose label cannot break out of the <url|label> syntax. */
export const mlink = (url: string, label: string) => `<${url}|${esc(label).replace(/\|/g, "/")}>`;
export const quoteLines = (s: string) => s.split("\n").map((l) => `> ${l}`).join("\n");

export const plain = (text: string, max = 150) => ({ type: "plain_text", text: clip(text, max) });
const md = (text: string, max: number) => ({ type: "mrkdwn", text: clip(text, max) });
export const section = (text: string) => ({ type: "section", text: md(text, 3000) });
export const context = (...texts: (string | null | undefined | false)[]) =>
  ({ type: "context", elements: texts.filter((t): t is string => !!t).slice(0, 10).map((t) => md(t, 2000)) });
export const divider = () => ({ type: "divider" });

export type Button = { type: "button"; text: { type: string; text: string }; action_id: string; value?: string; url?: string; confirm?: object; style?: "primary" };
export const button = (text: string, action_id: string, opts: { value?: string; url?: string; confirm?: object; style?: "primary" } = {}): Button =>
  ({ type: "button", text: plain(text, 75), action_id, ...opts });
/** The message's next step. At most one per actions block. */
export const primary = (text: string, action_id: string, opts: { value?: string; confirm?: object } = {}): Button => button(text, action_id, { ...opts, style: "primary" });
/** URL buttons still send a click to the interactions endpoint; the prefix tells it to only acknowledge. */
export const linkButton = (text: string, url: string, id: string): Button => button(text, `${LINK_PREFIX}_${id}`, { url });
export const actions = (elements: (Button | false | null | undefined | "")[]) =>
  ({ type: "actions", elements: elements.filter((e): e is Button => !!e).slice(0, 25) });
export const confirm = (title: string, text: string, ok: string) => ({ title: plain(title, 100), text: { type: "plain_text", text: clip(text, 300) }, confirm: plain(ok, 30), deny: plain("Cancel", 30) });

/** A localised timestamp; Slack renders it in the viewer's timezone. */
export const slackDate = (ms: number) => `<!date^${Math.floor(ms / 1000)}^{date_short_pretty} at {time}|${new Date(ms).toISOString()}>`;
