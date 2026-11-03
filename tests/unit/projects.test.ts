import { describe, it, expect } from "vitest";
import { parseCommentBody, projectStep, projectTimeline, threadComments, type ProjectActivity } from "@/lib/queries/projectHelpers";
import { nameFromEmail } from "@/components/triage/format";
import { activitySteps } from "@/lib/slack/messages";

const ctx = {
  type: "bug",
  solutions: [
    { id: "s1", title: "Retry button", summary: "Show a Retry button instead of a blank screen." },
    { id: "s2", title: "Offline banner", summary: "Say when the phone is offline." },
  ],
  draftSolutionId: "s1",
};
let seq = 0;
const row = (kind: string, payload: Record<string, unknown> = {}, o: Partial<ProjectActivity> = {}): ProjectActivity =>
  ({ id: ++seq, kind, user_id: "u1", payload, at: `2026-10-16T10:${String(seq).padStart(2, "0")}:00Z`, ...o });
const step = (kind: string, payload: Record<string, unknown> = {}) => projectStep(row(kind, payload), ctx);

describe("projectStep", () => {
  it("says why from what each step left behind", () => {
    expect(step("diagnosis_ready", { headline: "The send times out." })).toEqual({ what: "Cause found", why: "The send times out." });
    expect(step("draft_dispatched", { solution: "Retry button" })).toEqual({ what: 'Mocked up "Retry button"', why: "Show a Retry button instead of a blank screen." });
    expect(step("changes_requested", { note: "Make it bigger" })).toEqual({ what: "Asked for changes", why: "Make it bigger" });
    expect(step("flow_ready", { summary: "3 steps: 1 changed" })).toEqual({ what: "Drew the full flow", why: "3 steps: 1 changed" });
    expect(step("approved")).toEqual({ what: "Approved and shipped", why: "Show a Retry button instead of a blank screen." });
    expect(step("priority_changed", { from: 40, to: 60, reason: "Three more parents" })).toEqual({ what: "Rose in priority", why: "Three more parents" });
    expect(step("proposals_ready", { count: 2, from_diagnosis: true })).toEqual({ what: "Wrote 2 proposals from the cause", why: "Retry button and Offline banner" });
  });
  it("uses the issue type's own words for the first step", () => {
    expect(projectStep(row("diagnosis_started", { type: "new_feature" }), ctx)?.what).toBe("Started scoping");
    expect(step("diagnosis_started", { screen: "Messages" })?.what).toBe("Ran diagnostics on Messages");
  });
  it("leaves out reads, the conversation and housekeeping", () => {
    for (const k of ["viewed", "commented", "slack_sent", "lane_changed", "alert", "feedback_added"]) expect(step(k)).toBeNull();
  });
  it("has no why when nothing explains the step", () => {
    expect(step("assigned", { to: "me" })).toEqual({ what: "Took it on", why: null });
    expect(step("draft_dispatched", { solution: "Gone" })).toEqual({ what: 'Mocked up "Gone"', why: null });
    expect(step("retitled", { to: "x" })).toEqual({ what: "Renamed", why: null });
  });
});

describe("projectTimeline", () => {
  it("is newest first and names PMA for rows without a person", () => {
    const names = new Map([["u1", "Maya Okafor"]]);
    const t = projectTimeline([
      row("assigned", { to: "me" }, { at: "2026-10-14T09:00:00Z" }),
      row("viewed", {}, { at: "2026-10-15T09:00:00Z" }),
      row("diagnosis_ready", { headline: "Times out" }, { user_id: null, at: "2026-10-16T09:00:00Z" }),
      row("assigned", { to: "me" }, { user_id: "u9", at: "2026-10-13T09:00:00Z" }),
    ], names, ctx);
    expect(t.map((s) => [s.what, s.who])).toEqual([["Cause found", "PMA"], ["Took it on", "Maya Okafor"], ["Took it on", "A teammate"]]);
  });
});

describe("threadComments", () => {
  const names = new Map([["owner", "Thomas"], ["u2", "Maya Okafor"]]);
  it("nests replies under their thread, newest thread first, replies oldest first", () => {
    const update = row("commented", { text: "Mock-up is up", source: "web" }, { user_id: "owner", at: "2026-10-16T09:00:00Z" });
    const later = row("commented", { text: "A question", source: "web" }, { user_id: "u2", at: "2026-10-16T11:00:00Z" });
    const reply = row("commented", { text: "Looks good", reply_to: update.id }, { user_id: "u2", at: "2026-10-16T10:00:00Z" });
    const replyToReply = row("commented", { text: "Thanks", reply_to: reply.id }, { user_id: "owner", at: "2026-10-16T10:30:00Z" });
    const t = threadComments([replyToReply, later, reply, update], names, "owner");
    expect(t.map((p) => [p.text, p.kind, p.who])).toEqual([["A question", "comment", "Maya Okafor"], ["Mock-up is up", "update", "Thomas"]]);
    expect(t[1].replies.map((r) => [r.text, r.kind])).toEqual([["Looks good", "comment"], ["Thanks", "comment"]]);
  });
  it("keeps Slack replies and orphaned replies as their own threads", () => {
    const slack = row("commented", { text: "From Slack", source: "slack", name: "Dan" }, { user_id: null });
    const orphan = row("commented", { text: "Lost", reply_to: 99999 }, { user_id: "u2" });
    const t = threadComments([slack, orphan], names, "owner");
    expect(t.map((p) => [p.text, p.who, p.via])).toEqual([["Lost", "Maya Okafor", "web"], ["From Slack", "Dan", "slack"]]);
  });
});

describe("parseCommentBody", () => {
  it("trims and accepts an optional reply", () => {
    expect(parseCommentBody({ text: "  hi  " })).toEqual({ text: "hi", replyTo: null });
    expect(parseCommentBody({ text: "hi", replyTo: 12 })).toEqual({ text: "hi", replyTo: 12 });
  });
  it("rejects empty, too long and bad replies", () => {
    expect(parseCommentBody({ text: "   " })).toHaveProperty("error");
    expect(parseCommentBody({ text: "x".repeat(2001) })).toHaveProperty("error");
    expect(parseCommentBody({ text: "hi", replyTo: "abc" })).toHaveProperty("error");
    expect(parseCommentBody(null)).toHaveProperty("error");
  });
});

describe("nameFromEmail", () => {
  it("turns the local part into a name", () => {
    expect(nameFromEmail("maya.okafor@pma.test")).toBe("Maya Okafor");
    expect(nameFromEmail("daniel_reyes@x.is")).toBe("Daniel Reyes");
    expect(nameFromEmail("thomas@x.is")).toBe("Thomas");
  });
});

describe("a web reply in the Slack thread", () => {
  it("says who it answers", () => {
    expect(activitySteps({ kind: "commented", payload: { text: "Agreed", source: "web", reply_to: 4, reply_to_name: "Maya Okafor" } }, "Thomas"))
      .toEqual([{ kind: "text", text: "Thomas, replying to Maya Okafor: Agreed" }]);
  });
});
