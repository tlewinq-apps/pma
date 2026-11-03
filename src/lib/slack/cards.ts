// The issue card (one per issue, edited in place), the pinned board in #pma-feedback, each channel's guide and
// the App Home view. Pure. A card says what the issue is and offers its one next step; the work itself (the first
// step's result, the proposals, the mockup) happens in the card's thread.
import type { IssueType, Lane } from "@/lib/types";
import { stageLabel, type Stage } from "@/components/triage/views";
import { TYPE_LABEL, impactLabel, peopleLabel } from "@/components/triage/format";
import { CHECKS, checkOf } from "@/lib/diagnosis/checks";
import { isApproximate } from "@/lib/drafts/codeMockup";
import { ACTION, ref } from "./ids";
import { actions, button, clip, confirm, context, divider, esc, linkButton, mlink, primary, quoteLines, section, slackDate } from "./kit";

/** Same values as the --type-* tokens in globals.css. */
export const TYPE_COLOR: Record<IssueType, string> = { bug: "#b8382a", new_feature: "#6a4c9c", add_on: "#1f6f78", streamline: "#8a5a0b" };

export type ChannelRole = "inbox" | "cards" | IssueType;
/** The demo's channels: the inbox and one channel per type. */
export const CHANNEL_ROLES: readonly ChannelRole[] = ["inbox", "bug", "new_feature", "add_on", "streamline"];
/** A customer app's channels: the inbox (feedback in) and one cards channel (every issue card, its thread, the board). */
export const APP_CHANNEL_ROLES: readonly ChannelRole[] = ["inbox", "cards"];
// The front door gets a suffix too: Slack channel names share a namespace with usernames, and the bot is @pma.
const SUFFIX: Record<ChannelRole, string> = { inbox: "-feedback", cards: "-issues", bug: "-bugs", new_feature: "-features", add_on: "-add-ons", streamline: "-streamline" };
export const channelName = (prefix: string, role: ChannelRole) => `${prefix}${SUFFIX[role]}`;
/** Slack channel names: lowercase, no spaces, at most 80 chars (the longest suffix is 11). */
export const validPrefix = (p: string) => /^[a-z0-9][a-z0-9_-]{0,60}$/.test(p);

export type CardView = {
  issueId: string; title: string; type: IssueType; stage: Stage; lane: Lane | null; people: number; importance: number | null;
  /** The severity rating (1-5), shown as the impact word ("Blocker"). */
  severity: number | null;
  /** How many proposals the thread holds. */
  proposals: number;
  owner: string | null; quote: { text: string; author: string | null } | null;
  url: string; prUrl: string | null; draftId: string | null; failedSolutionId: string | null; demo: boolean;
  /** A customer app's approximate mock-up (drawn from its code): approving it means Ready to build, not shipped. */
  approximate?: boolean;
  /** How many people raised it, in a customer app's audience words ("1 shopper"), as the issue page says it. The demo sets none and keeps "1 person". */
  peopleText?: string;
};

/** As on the web (isApproximate): a mock-up drawn for a customer app, approved to build rather than shipped. An unknown
 *  kind counts as a customer app, as approval does, so Slack never promises to ship what approval won't. */
export const approximateMockup = (kind: string | null | undefined, draft: { backend: string | null } | null | undefined) => isApproximate(draft, { kind: kind ?? "" });

/** The approve button's words, as on the web: an approximate mock-up is approved to build, anything else ships. */
export const approveLabel = (approximate = false) => (approximate ? "Approve the mock-up" : "Approve and ship");

export const approveConfirm = (demo: boolean, approximate = false) => approximate
  ? confirm("Approve the mock-up?", "This marks it Ready to build. Nothing ships yet, and nobody who raised it is told until it's marked shipped.", approveLabel(true))
  : confirm("Approve and ship?", demo ? "This marks the issue shipped and tells the people who raised it." : "This merges the pull request, marks the issue shipped and tells the people who raised it.", approveLabel());

/** The card's buttons: its one next step (primary), anything that goes with it, and Open in PMA. */
export function cardButtons(v: CardView) {
  const issue = ref(v.issueId);
  const check = checkOf(v.type);
  const app = linkButton("Open in PMA", v.url, "app");
  const write = button(check.writeTitle, ACTION.write, { value: issue });
  switch (v.stage) {
    case "needs_diagnosis":
      return [primary(check.button, ACTION.diagnose, { value: issue }), app];
    case "needs_proposal":
      return [primary("Get proposals", ACTION.take, { value: issue }), write, app];
    case "proposal_ready":
      return [write, app];
    case "failed":
      return [v.failedSolutionId && primary("Retry the mockup", ACTION.retry, { value: ref(v.issueId, v.failedSolutionId) }), app];
    case "review": case "in_review":
      return [
        v.draftId && primary(approveLabel(v.approximate), ACTION.approve, { value: ref(v.issueId, v.draftId), confirm: approveConfirm(v.demo, v.approximate) }),
        v.draftId && button("Request changes", ACTION.changes, { value: ref(v.issueId, v.draftId) }),
        app,
      ];
    default:
      return [app];
  }
}

/** The stage in the card's words: "Needs scoping", or "3 proposals in the thread" once there are some to pick from. */
export function cardStage(v: Pick<CardView, "stage" | "type" | "proposals">): string {
  if (v.stage === "proposal_ready" && v.proposals > 0) return `${v.proposals} ${v.proposals === 1 ? "proposal" : "proposals"} in the thread`;
  return stageLabel(v.stage, v.type);
}

export function issueCard(v: CardView): { text: string; blocks: object[]; attachments: object[] } {
  const meta = [TYPE_LABEL[v.type], v.peopleText ?? peopleLabel(v.people), impactLabel(v.severity), cardStage(v)].filter(Boolean).join("  ·  ");
  const body: object[] = [context(meta)];
  if (v.quote) body.push(section(`${quoteLines(esc(clip(v.quote.text, 600)))}${v.quote.author ? `\n${esc(v.quote.author)}` : ""}`));
  body.push(actions(cardButtons(v)));
  return { text: `${TYPE_LABEL[v.type]}: ${v.title}`, blocks: [section(`*${mlink(v.url, v.title)}*`)], attachments: [{ color: TYPE_COLOR[v.type], blocks: body }] };
}

/** One line on the board or App Home. `link` is the card's thread permalink once it has one. */
export type BoardItem = { title: string; type: IssueType; stage: Stage; owner: string | null; ownerId: string | null; link: string | null; updatedAt: string; importance: number | null };

/** Highest priority first; unscored issues last. */
const byPriority = (a: BoardItem, b: BoardItem) => (b.importance ?? -1) - (a.importance ?? -1);

const WEEK = 7 * 86_400_000;
const isOpenProposal = (s: Stage) => s === "needs_proposal" || s === "proposal_ready" || s === "failed";
export const BOARD_GROUPS: { label: string; match: (i: BoardItem, now: number) => boolean }[] = [
  { label: "Taken on", match: (i) => !!i.owner && isOpenProposal(i.stage) },
  { label: "Drafting", match: (i) => i.stage === "drafting" },
  { label: "Ready for review", match: (i) => i.stage === "review" },
  { label: "In review", match: (i) => i.stage === "in_review" },
  { label: "Shipped this week", match: (i, now) => i.stage === "shipped" && now - Date.parse(i.updatedAt) <= WEEK },
];

const MAX_LINES = 8;
function groupBlock(label: string, items: BoardItem[], empty: string, showOwner = true) {
  const lines = [...items].sort(byPriority).slice(0, MAX_LINES).map((i) =>
    `• ${i.link ? mlink(i.link, i.title) : esc(i.title)}  ·  ${TYPE_LABEL[i.type]}${showOwner && i.owner ? `  ·  ${esc(i.owner)}` : ""}`);
  if (items.length > MAX_LINES) lines.push(`and ${items.length - MAX_LINES} more`);
  return section(`*${label}*${items.length ? `  ${items.length}` : ""}\n${lines.length ? lines.join("\n") : empty}`);
}

/** How a customer app's Slack talks about its feedback: who it comes from, in the app's product profile words. */
export type SlackWording = { audience: string };

export function boardMessage(items: BoardItem[], now: number, appUrl: string, customer?: SlackWording): { text: string; blocks: object[] } {
  const intro = customer
    ? `*What's being worked on*\nPMA files feedback from ${esc(customer.audience)} here, one card per issue. ${mlink(appUrl, "Open PMA")}`
    : `*What's being worked on*\nPost feedback in this channel and PMA files it into the right one. ${mlink(appUrl, "Open PMA")}`;
  return {
    text: customer ? "What's being worked on in PMA" : "What's being worked on in PMA",
    blocks: [
      section(intro),
      context(`Updated ${slackDate(now)}`),
      divider(),
      ...BOARD_GROUPS.map((g) => groupBlock(g.label, items.filter((i) => g.match(i, now)), "Nothing right now")),
    ],
  };
}

export function homeGroups(items: BoardItem[], me: string): { label: string; items: BoardItem[] }[] {
  return [
    { label: "Waiting on a first step", items: items.filter((i) => i.stage === "needs_diagnosis").sort(byPriority).slice(0, 5) },
    { label: "Taken on by you", items: items.filter((i) => i.ownerId === me && isOpenProposal(i.stage)) },
    { label: "Drafting", items: items.filter((i) => i.ownerId === me && i.stage === "drafting") },
    { label: "Waiting for your review", items: items.filter((i) => (i.stage === "review" || i.stage === "in_review") && (i.ownerId === me || !i.ownerId)) },
  ];
}

/** "<#C123>", which Slack renders as a clickable channel name; the plain name when the channel isn't set up. */
const channelRef = (channels: Partial<Record<ChannelRole, string>>, role: ChannelRole, fallback: string) => (channels[role] ? `<#${channels[role]}>` : fallback);

/** The four lines that explain PMA, for App Home. */
export function howItWorks(channels: Partial<Record<ChannelRole, string>>): string {
  const typeChannels = (["bug", "new_feature", "add_on", "streamline"] as const).map((r) => channelRef(channels, r, `#pma${SUFFIX[r]}`)).join(", ");
  return [
    "*How PMA works*",
    `1. Feedback goes in ${channelRef(channels, "inbox", "#pma-feedback")}, or use Send to PMA on any message.`,
    `2. PMA files each problem as one card in ${typeChannels}.`,
    `3. Every card starts with one first step: ${(["bug", "new_feature", "add_on", "streamline"] as const).map((t) => CHECKS[t].button).join(", ")}.`,
    "4. Pick a proposal in the card's thread, approve the mockup, and it ships. Whoever raised it is told in their own thread.",
  ].join("\n");
}

/** Each channel's purpose line (under 250 characters, Slack's limit). The demo's; a customer app's is appChannelPurpose. */
export const CHANNEL_PURPOSE: Record<ChannelRole, string> = {
  inbox: "Post feedback here. PMA files it into the right channel.",
  cards: "One card per issue from feedback. Take the first step, pick a proposal, approve the mockup.",
  bug: "Bugs from feedback. Run diagnostics, pick a fix, approve the mockup.",
  new_feature: "Feature requests from feedback. Scope it, pick a proposal, approve the mockup.",
  add_on: "Add-ons to existing screens. Find where it fits, pick a proposal, approve the mockup.",
  streamline: "Flows that are slow or confusing. Map the steps, pick a proposal, approve the mockup.",
};

/** The pinned "How this channel works" message, one per channel. */
export function channelGuide(role: ChannelRole, appUrl: string): { text: string; blocks: object[] } {
  const body: Record<ChannelRole, string> = {
    inbox: "Post any feedback here, or use Send to PMA on a message anywhere in Slack. PMA splits it into single problems, files each one into the right channel and replies in the thread with where it went.",
    cards: "One card per issue PMA finds in feedback. Press the card's first step, pick a proposal in its thread, then approve the mockup to ship it.",
    bug: `One card per bug PMA finds in feedback. Press *${CHECKS.bug.button}* to find the cause, pick a fix in the card's thread, then approve the mockup to ship it.`,
    new_feature: `One card per feature request. Press *${CHECKS.new_feature.button}* to see who wants it and the smallest useful version, pick a proposal in the card's thread, then approve the mockup.`,
    add_on: `One card per add-on: a new option on something that already exists. Press *${CHECKS.add_on.button}* to see which screen it extends, pick a proposal in the card's thread, then approve the mockup.`,
    streamline: `One card per flow that's slower or more confusing than it should be. Press *${CHECKS.streamline.button}* to see where people stall, pick a proposal in the card's thread, then approve the mockup.`,
  };
  return { text: "How this channel works", blocks: [section(`*How this channel works*\n${body[role]}`), context(mlink(appUrl, "Open PMA"))] };
}

/** The four lines that explain PMA for a customer app's App Home: the inbox, the cards channel, first steps, shipping. */
export function howItWorksForApp(channels: Partial<Record<ChannelRole, string>>, w: SlackWording): string {
  return [
    "*How PMA works*",
    `1. Feedback from ${esc(w.audience)} goes in ${channelRef(channels, "inbox", "the feedback channel")}, or use Send to PMA on any message.`,
    `2. PMA files each problem as one card in ${channelRef(channels, "cards", "the issues channel")}.`,
    `3. Every card starts with one first step: ${(["bug", "new_feature", "add_on", "streamline"] as const).map((t) => CHECKS[t].button).join(", ")}.`,
    "4. Pick a proposal in the card's thread and approve the mock-up: it's then ready to build. Once it's marked shipped, the people who raised it are told in their own thread.",
  ].join("\n");
}

export function homeView(h: { notMember: string | null; groups: { label: string; items: BoardItem[] }[]; appUrl: string; now: number; channels?: Partial<Record<ChannelRole, string>>; customer?: SlackWording }): object {
  const intro = h.customer
    ? section(`*PMA*\nFeedback from ${esc(h.customer.audience)} in, shipped fixes out. ${mlink(h.appUrl, "Open PMA")}`)
    : section(`*PMA*\nFeedback in, shipped fixes out. ${mlink(h.appUrl, "Open PMA")}`);
  const how = h.customer ? howItWorksForApp(h.channels ?? {}, h.customer) : howItWorks(h.channels ?? {});
  const head = [intro, section(how), context(`Updated ${slackDate(h.now)}`), divider()];
  if (h.notMember) return { type: "home", blocks: [...head, section(esc(h.notMember))] };
  return { type: "home", blocks: [...head, ...h.groups.map((g) => groupBlock(g.label, g.items, "Nothing here", false))] };
}

/** A customer app's channel purpose lines, in its own words (under 250 characters). */
export function appChannelPurpose(role: ChannelRole, w: SlackWording): string {
  const who = clip(w.audience, 60);
  return role === "inbox"
    ? `Post feedback from ${who} here. PMA files each problem as a card in the issues channel.`
    : `One card per issue PMA finds in feedback from ${who}. Take the first step, pick a proposal, approve the mockup.`;
}

/** A customer app's pinned "How this channel works" message for its inbox or cards channel. */
export function appChannelGuide(role: ChannelRole, appUrl: string, w: SlackWording, cardsChannel: string | null): { text: string; blocks: object[] } {
  const cards = cardsChannel ? `<#${cardsChannel}>` : "the issues channel";
  const body = role === "inbox"
    ? `Post any feedback from ${esc(w.audience)} here, or use Send to PMA on a message anywhere in Slack. PMA splits it into single problems, files each one as a card in ${cards} and replies in the thread with where it went.`
    : `One card per issue PMA finds in feedback. Each card starts with one first step (${(["bug", "new_feature", "add_on", "streamline"] as const).map((t) => `*${CHECKS[t].button}*`).join(", ")}). Then pick a proposal in the card's thread and approve the mockup. The board pinned here shows what's being worked on.`;
  return { text: "How this channel works", blocks: [section(`*How this channel works*\n${body}`), context(mlink(appUrl, "Open PMA"))] };
}
