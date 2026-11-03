// Slack forms: write your own proposal (one box), edit one, and request changes on a mockup. Pure. The write form
// says what the first step found so the writer knows what they're solving; PMA names the proposal and mocks up
// the issue's own screen, so the form asks only for the idea. Submissions go through the same actions as the web.
import { NOTE_MAX } from "@/lib/drafts/review";
import { checkOf } from "@/lib/diagnosis/checks";
import { VIEW, encodeMeta, type Meta } from "./ids";
import { context, esc, plain } from "./kit";

function input(block_id: string, label: string, element: object, optional = false, hint?: string) {
  return { type: "input", block_id, label: plain(label, 2000), element, optional, ...(hint ? { hint: plain(hint, 2000) } : {}) };
}
function text(initial: string | null | undefined, max: number, placeholder: string, multiline = false) {
  return { type: "plain_text_input", action_id: "v", max_length: max, multiline, placeholder: plain(placeholder), ...(initial ? { initial_value: initial } : {}) };
}

/** "Write a fix" / "Write a proposal": one box, labelled for the issue's type. */
export function writeModal(o: { mode: "write" | "edit"; meta: Meta; type: string; issueTitle: string; headline: string | null; screen: string | null; initial?: string | null }): object {
  const check = checkOf(o.type);
  const about = [`For *${esc(o.issueTitle)}*`, o.headline && `${check.result}: ${esc(o.headline)}`].filter(Boolean).join("\n");
  const hint = o.screen ? `PMA names it and mocks up ${o.screen}.` : "PMA names it for you.";
  return {
    type: "modal",
    callback_id: o.mode === "edit" ? VIEW.proposalEdit : VIEW.proposalWrite,
    private_metadata: encodeMeta(o.meta),
    title: plain(o.mode === "edit" ? "Edit proposal" : check.writeTitle, 24),
    submit: plain(o.mode === "edit" ? "Save" : "Add", 24),
    close: plain("Cancel", 24),
    blocks: [context(about), input("text", check.writeLabel, text(o.initial, 1000, check.writePlaceholder, true), false, hint)],
  };
}

export function changesModal(o: { meta: Meta; issueTitle: string }): object {
  return {
    type: "modal", callback_id: VIEW.changes, private_metadata: encodeMeta(o.meta),
    title: plain("Request changes", 24), submit: plain("Send", 24), close: plain("Cancel", 24),
    blocks: [
      context(`For *${esc(o.issueTitle)}*`),
      input("note", "What should change?", text(null, NOTE_MAX, "Tell the drafter what to do differently", true)),
    ],
  };
}

type Values = Record<string, Record<string, { value?: string | null }>>;

/** A submitted write form as the one-box body the proposal actions take. */
export const readProposalText = (values: unknown) => ({ text: (values as Values | undefined)?.text?.v?.value ?? "" });

export const readNote = (values: unknown) => ({ note: (values as Values | undefined)?.note?.v?.value ?? "" });

