import { describe, it, expect } from "vitest";
import { parseInteraction } from "@/lib/slack/interactions";

const issueId = "0b9e6a3c-1d2f-4a5b-8c7d-9e0f1a2b3c4d";
const solutionId = "f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b";
const click = (action_id: string, value?: string) => ({ type: "block_actions", user: { id: "U1" }, trigger_id: "T1", response_url: "https://hooks.slack.com/actions/x", actions: [{ action_id, value }] });

describe("parseInteraction", () => {
  it("maps buttons to commands with validated ids", () => {
    expect(parseInteraction(click("pma_take", issueId))).toEqual({ kind: "take", issueId, user: "U1", responseUrl: "https://hooks.slack.com/actions/x" });
    expect(parseInteraction(click("pma_mock", `${issueId}:${solutionId}`))).toMatchObject({ kind: "mock", issueId, solutionId });
    expect(parseInteraction(click("pma_retry", `${issueId}:${solutionId}`))).toMatchObject({ kind: "retry", solutionId });
    expect(parseInteraction(click("pma_approve", `${issueId}:${solutionId}`))).toMatchObject({ kind: "approve", draftId: solutionId });
    expect(parseInteraction(click("pma_write", issueId))).toMatchObject({ kind: "open_write", triggerId: "T1" });
    expect(parseInteraction(click("pma_edit", `${issueId}:${solutionId}`))).toMatchObject({ kind: "open_edit", solutionId });
    expect(parseInteraction(click("pma_changes", `${issueId}:${solutionId}`))).toMatchObject({ kind: "open_changes", draftId: solutionId });
  });
  it("ignores link buttons, unknown actions and tampered values", () => {
    expect(parseInteraction(click("pma_link_app"))).toEqual({ kind: "ignore" });
    expect(parseInteraction(click("pma_nope", issueId))).toEqual({ kind: "ignore" });
    expect(parseInteraction(click("pma_take", "1 or 1=1"))).toEqual({ kind: "ignore" });
    expect(parseInteraction(click("pma_mock", issueId))).toEqual({ kind: "ignore" });
    expect(parseInteraction({ type: "block_actions", actions: [{ action_id: "pma_take", value: issueId }] })).toEqual({ kind: "ignore" });
    expect(parseInteraction(null)).toEqual({ kind: "ignore" });
  });
  it("reads form submissions with their metadata", () => {
    const view = (callback_id: string, meta: object) => ({ type: "view_submission", user: { id: "U1" }, view: { callback_id, private_metadata: JSON.stringify(meta), state: { values: { title: {} } } } });
    expect(parseInteraction(view("pma_proposal_write", { issueId }))).toEqual({ kind: "submit_write", meta: { issueId }, values: { title: {} }, user: "U1" });
    expect(parseInteraction(view("pma_proposal_edit", { issueId, solutionId }))).toMatchObject({ kind: "submit_edit" });
    expect(parseInteraction(view("pma_proposal_edit", { issueId }))).toEqual({ kind: "ignore" });
    expect(parseInteraction(view("pma_changes_note", { issueId, draftId: solutionId }))).toMatchObject({ kind: "submit_changes" });
    expect(parseInteraction(view("pma_changes_note", { issueId }))).toEqual({ kind: "ignore" });
  });
  it("reads the Send to PMA shortcut", () => {
    const sc = { type: "message_action", callback_id: "pma_send", user: { id: "U1" }, response_url: "https://hooks.slack.com/x", channel: { id: "C1", name: "general" }, message: { ts: "1.2", text: "The app logged me out" } };
    expect(parseInteraction(sc)).toEqual({ kind: "send", channel: "C1", channelName: "general", ts: "1.2", text: "The app logged me out", user: "U1", responseUrl: "https://hooks.slack.com/x" });
    expect(parseInteraction({ ...sc, callback_id: "other" })).toEqual({ kind: "ignore" });
  });
});
