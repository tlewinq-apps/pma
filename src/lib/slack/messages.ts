// What goes into an issue's thread, kept short: who started the first step, one message with what it found, one
// proposals message (edited in place as proposals change), the mockup, and one plain line per other activity row.
// Pure. The sync engine turns Steps into Slack calls; the "Filed under" reply for #pma-feedback lives here too.
import type { IssueType } from "@/lib/types";
import type { Stage } from "@/components/triage/views";
import { RAIL_LABEL, TYPE_LABEL, joinNames } from "@/components/triage/format";
import { checkOf } from "@/lib/diagnosis/checks";
import { alertThreadText } from "@/lib/alerts/messages";
import { ACTION, ref } from "./ids";
import { approveConfirm, approveLabel } from "./cards";
import { actions, button, clip, context, esc, isHttps, linkButton, mlink, plain, primary, quoteLines, section } from "./kit";

export const letterFor = (index: number) => String.fromCharCode(65 + (index % 26));

export type ProposalOption = {
  solutionId: string; letter: string; title: string; summary: string; recommended: boolean;
  /** Who wrote it, for proposals your team wrote ("by Thomas"); null for PMA's. */
  by: string | null;
  /** "Mocked up", "Drafting now", or null. */
  status: string | null;
};

/** Stages where a proposal can be mocked up from the thread. */
const CAN_MOCK = new Set<Stage>(["needs_proposal", "proposal_ready", "failed", "review", "in_review"]);

/**
 * All of an issue's proposals in one message: "3 ways to fix it", then each option with Mock this up (primary on the
 * recommended one, unless a mockup is already waiting for review), and Write your own at the foot.
 */
export function proposalsMessage(p: { issueId: string; type: string; stage: Stage; options: ProposalOption[] }): { text: string; blocks: object[] } {
  const check = checkOf(p.type);
  const n = p.options.length;
  const head = `${n === 1 ? "One way" : `${n} ways`} to ${check.ways}`;
  if (!n) return { text: "No proposals yet.", blocks: [context("No proposals yet.")] };
  const mockable = CAN_MOCK.has(p.stage);
  const reviewing = p.stage === "review" || p.stage === "in_review";
  const blocks: object[] = [section(`*${head}*`)];
  for (const o of p.options) {
    const tags = [o.recommended && "Recommended", o.by && `by ${esc(o.by)}`, o.status].filter(Boolean).join("  ·  ");
    const value = ref(p.issueId, o.solutionId);
    const label = reviewing ? "Mock this instead" : "Mock this up";
    const accessory = mockable && o.status !== "Drafting now" && !(reviewing && o.status === "Mocked up")
      ? (o.recommended && !reviewing ? primary(label, ACTION.mock, { value }) : button(label, ACTION.mock, { value }))
      : null;
    blocks.push({
      ...section(`*${o.letter}. ${esc(o.title)}*${tags ? `  ·  ${tags}` : ""}\n${esc(clip(o.summary, 300))}`),
      ...(accessory ? { accessory } : {}),
    });
  }
  if (p.stage !== "shipped" && p.stage !== "dismissed") blocks.push(actions([button("Write your own", ACTION.write, { value: ref(p.issueId) })]));
  return { text: head, blocks };
}

/** A posted proposal whose solution no longer exists (re-proposed or removed), or an old one-per-proposal message. */
export const proposalGoneMessage = () => ({ text: "This proposal was replaced or removed.", blocks: [context("This proposal was replaced or removed. The current ones are further down this thread.")] });

/** What the first step found, as its own message: the result word and headline, then up to two short lines. */
export function checkResultMessage(type: string, r: { headline: string; lines: string[] }): { text: string; blocks: object[] } {
  const done = checkOf(type).done;
  const lines = r.lines.filter(Boolean).slice(0, 2).map((l) => esc(clip(l, 300)));
  return {
    text: `${done} ${r.headline}`,
    blocks: [section(`*${done}* ${esc(clip(r.headline, 600))}`), ...(lines.length ? [context(...lines)] : [])],
  };
}

export type MockupView = {
  issueId: string; draftId: string; solutionTitle: string; demo: boolean;
  /** A real pull request in the design repo (not the demo renderer or the mock runner's simulated one). */
  github: boolean;
  images: { label: string; url: string }[]; prUrl: string | null; url: string; closed: string | null;
  /** The design agent's one line on what changed, and the Marver frame it edited. */
  changed?: string | null; path?: string | null;
  /** The mock-up has a Marver frame, so Create full flow can build the whole flow from it. */
  flowable?: boolean;
  /** A customer app's approximate mock-up: approving it means Ready to build, not shipped. */
  approximate?: boolean;
};

export function mockupMessage(m: MockupView): { text: string; blocks: object[] } {
  const images = m.images.filter((i) => isHttps(i.url)).slice(0, 6)
    .map((i) => ({ type: "image", image_url: i.url, alt_text: clip(i.label, 2000), title: plain(i.label, 2000) }));
  const value = ref(m.issueId, m.draftId);
  return {
    text: `Mockup: ${m.solutionTitle}`,
    blocks: [
      section(`*Mockup: ${esc(m.solutionTitle)}*${m.github && isHttps(m.prUrl) ? `  ·  ${mlink(m.prUrl, "Open the pull request")}` : ""}`),
      ...(images.length ? images : [context(`${mlink(m.url, "Open in PMA")} to see the frames.`)]),
      ...(m.changed ? [context(`${esc(clip(m.changed, 300))}${m.path ? `\nEdited \`${esc(m.path)}\` on the Marver canvas.` : ""}`)] : []),
      m.closed ? context(esc(m.closed)) : actions([
        primary(approveLabel(m.approximate), ACTION.approve, { value, confirm: approveConfirm(!m.github, m.approximate) }),
        button("Request changes", ACTION.changes, { value }),
        m.flowable && button("Create full flow", ACTION.flow, { value }),
      ]),
    ],
  };
}

/**
 * The full flow, once drawn: one image with today's flow over the proposed one, where it came from in Marver, and a
 * link that opens the flow pop-up in PMA.
 */
export function flowMessage(f: { title: string; proposal: string; board: string | null; summary: string; imageUrl: string | null; url: string }): { text: string; blocks: object[] } {
  const from = f.board ? `From the Marver board \`${esc(f.board)}\`` : "From this issue's screens";
  return {
    text: `Full flow: ${f.proposal}`,
    blocks: [
      section(`*Full flow: ${esc(f.proposal)}*\n${from}. Today's ${esc(f.title)} flow on top, the proposed one below. ${esc(f.summary)}.`),
      ...(isHttps(f.imageUrl) ? [{ type: "image", image_url: f.imageUrl, alt_text: clip(`${f.title}: current flow over proposed flow`, 2000), title: plain(`${f.title}, full flow`, 2000) }] : []),
      actions([linkButton("View full flow", `${f.url}?flow=1`, "flow")]),
    ],
  };
}

export function failedMessage(f: { issueId: string; solutionId: string | null; logUrl: string | null; url: string }): { text: string; blocks: object[] } {
  return {
    text: "The mockup didn't finish.",
    blocks: [
      section(`*The mockup didn't finish.*${isHttps(f.logUrl) ? ` ${mlink(f.logUrl, "See the log")}.` : ""}`),
      actions([f.solutionId && primary("Retry the mockup", ACTION.retry, { value: ref(f.issueId, f.solutionId) })]),
    ],
  };
}

export type Step =
  /** `broadcast` also shows the thread reply in the channel (alerts). */
  | { kind: "text"; text: string; broadcast?: boolean }
  | { kind: "message"; msg: { text: string; blocks: object[] } }
  /** Post the proposals message, or bring the posted one up to date. */
  | { kind: "proposals" }
  | { kind: "mockup" }
  | { kind: "close_mockup"; draftId: string | null; note: string }
  /** Post the drafted full flow (current over proposed) for this draft. */
  | { kind: "flow"; draftId: string }
  | { kind: "failed"; logUrl: string | null };

const str = (v: unknown) => (typeof v === "string" ? v : "");

const lines = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** One activity row as thread steps. `who` is the actor's name ("PMA" for automated rows); `type` the issue's. */
export function activitySteps(a: { kind: string; payload: Record<string, unknown> | null }, who: string, type: string = "bug"): Step[] {
  const p = a.payload ?? {};
  const t = str(p.type) || type;
  const text = (x: string): Step => ({ kind: "text", text: x });
  const proposals: Step = { kind: "proposals" };
  switch (a.kind) {
    case "feedback_added":
      if (p.created) return [];
      return [text(`New feedback${p.author ? ` from ${esc(str(p.author))}` : ""}:\n${quoteLines(esc(clip(str(p.quote), 600)))}`)];
    // Taken on together with another action (running the first step, a mockup): that action's own line says who.
    case "assigned": return p.auto ? [] : [text(p.to === "me" ? `Taken on by ${esc(who)}.` : `${esc(who)} is no longer on this.`)];
    case "diagnosis_started": return [text(`${esc(who)} ${checkOf(t).verb}.`)];
    case "diagnosis_ready": return [{ kind: "message", msg: checkResultMessage(t, { headline: str(p.headline) || str(p.cause), lines: lines(p.lines) }) }];
    case "diagnosis_failed": return [text(`${checkOf(t).button} didn't finish${p.error ? `: ${esc(clip(str(p.error), 200))}` : ""}. Press ${checkOf(t).button} on the card to try again.`)];
    case "proposals_ready": case "proposal_added": case "proposal_edited": case "proposal_restored": case "proposal_removed": return [proposals];
    case "draft_dispatched": return [
      { kind: "close_mockup", draftId: null, note: "Replaced by a newer mockup." },
      text(`Mocking up${p.solution ? ` "${esc(str(p.solution))}"` : ""}. ${p.demo ? "Ready in a few seconds." : p.mock ? "Ready in under a minute." : "This takes a few minutes."}`),
      proposals,
    ];
    case "draft_ready": return [{ kind: "mockup" }, proposals];
    case "draft_failed": return [{ kind: "failed", logUrl: str(p.log_url) || null }, proposals];
    case "flow_requested": return [text(`${esc(who)} asked for the full ${p.flow ? `"${esc(str(p.flow))}" ` : ""}flow. It lands here once the changed screens are drawn.`)];
    case "flow_ready": return str(p.draft_id) ? [{ kind: "flow", draftId: str(p.draft_id) }] : [];
    case "flow_failed": return [text(`The full flow didn't finish${p.error ? `: ${esc(clip(str(p.error), 200))}` : ""}. Press Create full flow on the mockup to try again.`)];
    case "changes_requested": return [
      { kind: "close_mockup", draftId: str(p.draft_id) || null, note: `Changes requested by ${who}.` },
      text(`${esc(who)} asked for changes:\n${quoteLines(esc(clip(str(p.note), 1000)))}`),
    ];
    case "approved": return [
      { kind: "close_mockup", draftId: str(p.draft_id) || null, note: `Approved by ${who}.` },
      // A customer app's approximate mock-up is approved, not shipped: it ships when its code pull request merges.
      text(p.approximate ? `Approved by ${esc(who)}. Ready to build.` : `Shipped. Approved by ${esc(who)}.`),
      proposals,
    ];
    case "dismissed": return [text(`Dismissed by ${esc(who)}.`)];
    case "decision": return [text(`Decision from ${esc(who)}: ${esc(clip(str(p.text), 1000))}`)];
    case "relabeled": {
      const label = (x: unknown) => TYPE_LABEL[x as IssueType] ?? str(x);
      return [text(`Re-labelled from ${label(p.from)} to ${label(p.to)} by ${esc(who)}.`)];
    }
    case "retitled": return [text(`Renamed to "${esc(str(p.to))}" by ${esc(who)}.`)];
    case "lane_action_failed": return [text(`PMA couldn't finish that: ${esc(clip(str(p.error), 300))}`)];
    case "alert": return [{ kind: "text", text: alertThreadText(p), broadcast: true }];
    case "reporters_told": return [text(`Told ${esc(joinNames(p.names))} in their own threads.`)];
    case "followup_answered": return [text(`${esc(str(p.name) || "Someone")} answered the follow-up:\n${quoteLines(esc(clip(str(p.quote), 600)))}${Array.isArray(p.filed) && p.filed.length ? `\nFiled under ${esc(joinNames(p.filed))}.` : ""}`)];
    case "followups_asked": return [text(`${esc(who)} asked ${esc(joinNames(p.names))} follow-up questions. Their answers come back as new feedback.`)];
    // Comments typed in Slack are already in the thread; anything else commented elsewhere is shown.
    case "commented": return p.source === "slack" ? [] : [text(`${esc(who)}${p.reply_to_name ? `, replying to ${esc(str(p.reply_to_name))}` : ""}: ${esc(clip(str(p.text), 1500))}`)];
    default: return [];
  }
}

/**
 * What a brand-new card's thread shows so it isn't empty: nothing while the first step waits (the card's button is
 * the next move), a line while it runs, then what it found, the proposals and the latest mockup.
 */
export function catchUpSteps(stage: Stage, proposals: number, type: string = "bug", finding: { headline: string; lines: string[] } | null = null): Step[] {
  if (stage === "needs_diagnosis" || stage === "dismissed") return [];
  if (stage === "diagnosing") return [{ kind: "text", text: checkOf(type).nextRunning }];
  const steps: Step[] = finding ? [{ kind: "message", msg: checkResultMessage(type, finding) }] : [];
  if (proposals > 0) steps.push({ kind: "proposals" });
  if (stage === "drafting") steps.push({ kind: "text", text: "A mockup is being drafted." });
  if (stage === "review" || stage === "in_review") steps.push({ kind: "mockup" });
  if (stage === "failed") steps.push({ kind: "failed", logUrl: null });
  return steps;
}

/** The reply under a message posted in #pma-feedback (or sent with the shortcut), once the pipeline has filed it. */
export function filedText(r: { status: "done" | "failed" | "duplicate"; issues: { type: IssueType; title: string; link: string | null; created: boolean; people: number }[] }): string {
  if (r.status === "failed") return "PMA couldn't read this one. It will try again in a few minutes.";
  if (!r.issues.length) return r.status === "duplicate" ? "This is already in PMA." : "Nothing to file: this reads as praise, a question or off-topic. It's kept in PMA under Add feedback.";
  const line = (i: (typeof r.issues)[number]) => {
    const title = i.link ? mlink(i.link, i.title) : `*${esc(i.title)}*`;
    return `${RAIL_LABEL[i.type]}: ${title}${i.created ? " (new)" : `, now ${Math.round(i.people)} ${Math.round(i.people) === 1 ? "person" : "people"}`}`;
  };
  const head = r.status === "duplicate" ? "Already in PMA." : "Filed.";
  return r.issues.length === 1 ? `${head} ${line(r.issues[0])}` : `${head}\n${r.issues.map((i) => `• ${line(i)}`).join("\n")}`;
}
