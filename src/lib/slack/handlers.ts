// Slack clicks, forms and the shortcut, run through the same actions as the web workspace. Only members act;
// anyone can send feedback. Refusals go back privately (response_url), never into the thread.
import { env } from "@/lib/env";
import { after } from "next/server";
import { serviceDb } from "@/lib/db/server";
import { proposalContext, addProposal, editProposal, nameProposalLater, type WriteResult } from "@/lib/actions/proposals";
import { startDraft, requestChanges } from "@/lib/actions/drafting";
import { approveAndMerge } from "@/lib/actions/approve";
import { runFlowDraft, startFlowDraft } from "@/lib/actions/flow";
import { assignIfUnowned, takeOn } from "@/lib/actions/takeOn";
import { proposeOnly } from "@/lib/actions/solveAndDraft";
import { runDiagnosis, startDiagnosis } from "@/lib/diagnosis/run";
import { parseDiagnosis } from "@/lib/diagnosis/model";
import { checkFirst } from "@/lib/diagnosis/checks";
import { logLaneActionFailed } from "@/lib/actions/laneFailure";
import { editLocked } from "@/lib/proposals";
import { parseNote } from "@/lib/drafts/review";
import { ephemeral, respond, slackApi } from "./api";
import { changesModal, readNote, readProposalText, writeModal } from "./modals";
import { ingestSlackMessage, replyFiled, runFeedbackFlow } from "./inbox";
import { connectionForChannel, firstConnection, syncIssueToSlack } from "./sync";
import { brand, currentSlack } from "./context";
import { appsForSlack } from "./tenant";
import { notMemberText, resolveSlackUser } from "./users";
import { claudeAvailable } from "@/lib/connections/claude";
import type { Interaction } from "./interactions";

const tell = (responseUrl: string | null, text: string) => (responseUrl ? respond(responseUrl, ephemeral(text)) : Promise.resolve());

/**
 * The acting member and the issue, or null after telling the user why not. The click came from one workspace
 * (withSlack): the issue must belong to an app of the company that installed PMA there, and the person must be in
 * that company.
 */
async function actor(user: string, issueId: string, responseUrl: string | null) {
  const slack = currentSlack();
  if (!slack) { await tell(responseUrl, `${brand()} isn't set up in this workspace yet.`); return null; }
  const [apps, { data: issue }] = await Promise.all([
    appsForSlack(slack),
    serviceDb().from("issues").select("id, project_id, title").eq("id", issueId).maybeSingle(),
  ]);
  if (!issue || !apps.includes(issue.project_id as string)) { await tell(responseUrl, `That issue isn't in ${brand()} anymore.`); return null; }
  const person = await resolveSlackUser(user, issue.project_id as string);
  if (!person.userId) { await tell(responseUrl, notMemberText(person)); return null; }
  return { userId: person.userId, name: person.name, issue: issue as { id: string; project_id: string; title: string } };
}

/** The latest draft, if it's the one this button was posted with and it can still be reviewed. */
async function reviewableDraft(issueId: string, draftId: string): Promise<string | null> {
  const { data: d } = await serviceDb().from("drafts").select("id, status, pr_state").eq("issue_id", issueId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!d || d.id !== draftId) return "A newer mockup replaced this one. Use the buttons on the latest mockup.";
  if (d.status !== "ready" || d.pr_state === "merged") return "This mockup was already approved or replaced.";
  return null;
}

/** Opens a form. Called before acknowledging: Slack's trigger_id expires 3 s after the click. */
export async function openModal(it: Extract<Interaction, { kind: "open_write" | "open_edit" | "open_changes" }>): Promise<void> {
  try {
    const a = await actor(it.user, it.issueId, it.responseUrl);
    if (!a) return;
    const db = serviceDb();
    if (it.kind === "open_changes") {
      const stale = await reviewableDraft(it.issueId, it.draftId);
      if (stale) return void (await tell(it.responseUrl, stale));
      await slackApi("views.open", { trigger_id: it.triggerId, view: changesModal({ meta: { issueId: it.issueId, draftId: it.draftId }, issueTitle: a.issue.title }) });
      return;
    }
    const ctx = await proposalContext(db, it.issueId);
    if (!ctx) return void (await tell(it.responseUrl, `That issue isn't in ${brand()} anymore.`));
    if (ctx.stage === "needs_diagnosis" || ctx.stage === "diagnosing") return void (await tell(it.responseUrl, checkFirst(ctx.type)));
    const [{ data: issue }, { data: screen }, sol] = await Promise.all([
      db.from("issues").select("diagnosis").eq("id", it.issueId).maybeSingle(),
      ctx.defaultFrames[0] ? db.from("screens").select("title, frame_id").eq("project_id", a.issue.project_id).eq("frame_id", ctx.defaultFrames[0]).maybeSingle() : Promise.resolve({ data: null }),
      it.kind === "open_edit" ? db.from("solutions").select("id, summary").eq("id", it.solutionId).eq("issue_id", it.issueId).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    if (it.kind === "open_edit") {
      if (!sol.data) return void (await tell(it.responseUrl, "That proposal was replaced or removed."));
      const lock = editLocked(ctx.stage, ctx.draftSolutionId, it.solutionId);
      if (lock) return void (await tell(it.responseUrl, lock));
    }
    const d = parseDiagnosis(issue?.diagnosis);
    await slackApi("views.open", {
      trigger_id: it.triggerId,
      view: writeModal({
        mode: it.kind === "open_edit" ? "edit" : "write", meta: it.kind === "open_edit" ? { issueId: it.issueId, solutionId: it.solutionId } : { issueId: it.issueId },
        type: ctx.type, issueTitle: a.issue.title, headline: d?.status === "done" ? d.finding?.headline ?? null : null,
        screen: screen ? (screen as { title: string | null; frame_id: string }).title ?? (screen as { frame_id: string }).frame_id : null,
        initial: (sol.data as { summary: string } | null)?.summary ?? null,
      }),
    });
  } catch (e) {
    console.error("[slack] open form failed", e);
    await tell(it.responseUrl, "Slack took too long to open the form. Try the button again.");
  }
}

/** A submitted form: inline field errors for Slack to show, or null to close it. Writes run now; the sync after. */
export async function handleSubmission(it: Extract<Interaction, { kind: "submit_write" | "submit_edit" | "submit_changes" }>): Promise<Record<string, string> | null> {
  const first = it.kind === "submit_changes" ? "note" : "text";
  const a = await actor(it.user, it.meta.issueId, null);
  if (!a) return { [first]: `You can't change this issue from Slack. Check that your Slack email is a ${brand()} member.` };
  const db = serviceDb();
  if (it.kind === "submit_changes") {
    const parsed = parseNote(readNote(it.values));
    if ("error" in parsed) return { note: parsed.error };
    const stale = await reviewableDraft(it.meta.issueId, it.meta.draftId!);
    if (stale) return { note: stale };
    after(async () => {
      const r = await requestChanges(db, it.meta.issueId, a.userId, parsed.note);
      if (!r.ok) await logLaneActionFailed(it.meta.issueId, "slack", new Error(r.error));
      await syncIssueToSlack(it.meta.issueId);
    });
    return null;
  }
  const body = readProposalText(it.values);
  const r: WriteResult = it.kind === "submit_edit"
    ? await editProposal(db, it.meta.issueId, it.meta.solutionId!, a.userId, body)
    : await addProposal(db, it.meta.issueId, a.userId, body);
  if (!r.ok) return { text: r.error };
  after(async () => {
    await syncIssueToSlack(it.meta.issueId);
    if (r.rename) await nameProposalLater(it.meta.issueId, r.id, r.rename);
  });
  return null;
}

const DRAFT_ERRORS: Record<string, string> = {
  "draft in progress": "A mockup is already being drafted for this issue.",
  "unknown solution": "That proposal was replaced or removed.",
};

/** Buttons that don't open a form, and the shortcut. Runs after the acknowledgement. Never throws. */
export async function handleAction(it: Exclude<Interaction, { kind: "ignore" | "open_write" | "open_edit" | "open_changes" | "submit_write" | "submit_edit" | "submit_changes" }>): Promise<void> {
  try {
    if (it.kind === "send") {
      // Filed into the app whose channel the message is in, else the workspace's first app with channels.
      const slack = currentSlack();
      const apps = slack ? await appsForSlack(slack) : [];
      const conn = (await connectionForChannel(it.channel, apps)) ?? (await firstConnection(apps));
      if (!conn) return void (await tell(it.responseUrl, `${brand()} isn't set up in this workspace yet.`));
      if (!it.text.trim()) return void (await tell(it.responseUrl, "That message has no text to send."));
      const r = await ingestSlackMessage({ projectId: conn.projectId, channel: it.channel, channelName: it.channelName ?? undefined, ts: it.ts, user: it.user, text: it.text, via: "shortcut" });
      const reply = { kind: "ephemeral" as const, responseUrl: it.responseUrl! };
      return r.duplicate ? replyFiled(r.id, reply, "duplicate") : runFeedbackFlow(r.id, reply);
    }
    const a = await actor(it.user, it.issueId, it.responseUrl);
    if (!a) return;
    const db = serviceDb();
    if (it.kind === "take") {
      const r = await takeOn(db, it.issueId, a.userId);
      if (!r.ok) return void (await tell(it.responseUrl, r.error));
      if (r.ownerId !== a.userId && !r.propose) await tell(it.responseUrl, "Someone else already owns this one.");
      await syncIssueToSlack(it.issueId);
      if (!r.propose) return;
      if (!(await claudeAvailable(a.issue.project_id))) return void (await tell(it.responseUrl, "Writing proposals needs a Claude key. An owner or admin adds it in PMA, or press Write your own."));
      try { await proposeOnly(it.issueId, r.propose); } catch (e) { await logLaneActionFailed(it.issueId, "slack", e); }
      await syncIssueToSlack(it.issueId);
      return;
    }
    if (it.kind === "diagnose") {
      const r = await startDiagnosis(it.issueId, a.userId, a.name, "slack");
      if (!r.ok) return void (await tell(it.responseUrl, r.error));
      await syncIssueToSlack(it.issueId); // the card shows the step running and the thread says who started it
      await runDiagnosis(it.issueId, { afterFinding: (id) => syncIssueToSlack(id) });
      await syncIssueToSlack(it.issueId); // then the proposals written from it
      return;
    }
    if (it.kind === "mock" || it.kind === "retry") {
      const r = await startDraft(db, it.issueId, it.solutionId);
      if (!r.ok) await tell(it.responseUrl, DRAFT_ERRORS[r.error] ?? r.error);
      else await assignIfUnowned(db, it.issueId, a.userId, "slack");
      await syncIssueToSlack(it.issueId); // in demo mode this waits for the draft and posts the mockup
      return;
    }
    if (it.kind === "flow") {
      const { data: latest } = await db.from("drafts").select("id").eq("issue_id", it.issueId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (latest?.id !== it.draftId) return void (await tell(it.responseUrl, "A newer mockup replaced this one. Use Create full flow on the latest mockup."));
      const r = await startFlowDraft(it.issueId, { userId: a.userId, name: a.name, via: "slack" });
      if (!r.ok) return void (await tell(it.responseUrl, r.error));
      if (r.already === "ready") return void (await tell(it.responseUrl, "The full flow is already in this thread."));
      if (r.already === "drafting") return void (await tell(it.responseUrl, "The full flow is being drawn. It lands in this thread shortly."));
      await tell(it.responseUrl, "Drafting the full flow from the Marver board. It lands in this thread in about a minute.");
      await syncIssueToSlack(it.issueId); // the thread says who asked
      await runFlowDraft(r.draftId);
      await syncIssueToSlack(it.issueId); // then the flow itself
      return;
    }
    if (it.kind === "approve") {
      const stale = await reviewableDraft(it.issueId, it.draftId);
      if (stale) return void (await tell(it.responseUrl, stale));
      // Slack's Approve uses the app's saved default; a pull-request default starts Build it on this deployment.
      const r = await approveAndMerge(it.issueId, a.userId, { origin: env.appUrl() });
      if (!r.ok) await tell(it.responseUrl, r.error);
      await syncIssueToSlack(it.issueId);
    }
  } catch (e) {
    console.error("[slack] action failed", e);
    await tell(it.responseUrl, `Something went wrong in ${brand()}. Try again in a moment.`);
  }
}
