import { describe, it, expect } from "vitest";
import { groupQuotesBySource, marverBranchUrl, describeActivity, quoteSpeaker, sourceHeading } from "@/lib/queries/issueHelpers";

const q = (id: string, source_id: string, author: string | null, channel: string | null, at: string) =>
  ({ id, quote: `quote ${id}`, speakers: ["s"], source_id, author, channel, at });

describe("groupQuotesBySource", () => {
  it("groups by source_id preserving first-seen order, with heading data", () => {
    const g = groupQuotesBySource([
      q("1", "a", "Ann", "Slack", "2026-01-02T00:00:00Z"),
      q("2", "b", null, null, "2026-01-03T00:00:00Z"),
      q("3", "a", "Ann", "Slack", "2026-01-02T00:00:00Z"),
    ]);
    expect(g.map((x) => x.source_id)).toEqual(["a", "b"]);
    expect(g[0].quotes.map((x) => x.id)).toEqual(["1", "3"]);
    expect(g[0].author).toBe("Ann");
    expect(g[0].channel).toBe("Slack");
    expect(g[1].author).toBeNull();
  });
  it("returns empty for no quotes", () => expect(groupQuotesBySource([])).toEqual([]));
});

describe("marverBranchUrl", () => {
  it("builds a GitHub tree URL", () => {
    expect(marverBranchUrl("acme/app", "pma/fix-1", "marver")).toBe("https://github.com/acme/app/tree/pma/fix-1/marver");
  });
  it("returns null when any input is missing", () => {
    expect(marverBranchUrl(null, "b", "m")).toBeNull();
    expect(marverBranchUrl("a/b", null, "m")).toBeNull();
    expect(marverBranchUrl("a/b", "b", "")).toBeNull();
    expect(marverBranchUrl(undefined, undefined, undefined)).toBeNull();
  });
});

describe("describeActivity", () => {
  const a = (kind: string, payload: Record<string, unknown> = {}) => ({ kind, payload });
  it("formats decision with truncation", () => {
    expect(describeActivity(a("decision", { text: "Ship it" })).text).toBe("decision: Ship it");
    const long = describeActivity(a("decision", { text: "x".repeat(300) })).text;
    expect(long.length).toBeLessThanOrEqual("decision: ".length + 121);
    expect(long.endsWith("…")).toBe(true);
  });
  it("formats relabel, lane change, retitle, assign", () => {
    expect(describeActivity(a("relabeled", { from: "bug", to: "add_on" })).text).toBe("re-labelled bug → add_on");
    expect(describeActivity(a("lane_changed", { from: "watch", to: "explore" })).text).toBe("moved from Rising to Needs a decision");
    expect(describeActivity(a("lane_changed", { from: null, to: "quick_win" })).text).toBe("sorted into Quick win");
    expect(describeActivity(a("priority_changed", { from: 52, to: 71, reason: "4 more people" })).text).toBe("rose in priority: 4 more people");
    expect(describeActivity(a("priority_changed", { from: null, to: 64, reason: "First scored" })).text).toBe("first rated");
    expect(describeActivity(a("alert", { rule: "jump", from: 52, to: 71, sent_to: ["Thomas"] })).text).toBe("alert: rising fast since yesterday, sent to Thomas");
    expect(describeActivity(a("alert", { rule: "blocking_bug", priority: 72, sent_to: [] })).text).toBe("alert: new bug that blocks people");
    expect(describeActivity(a("alert", { rule: "blocking_bug", priority: 81, new: false, sent_to: [] })).text).toBe("alert: this bug now blocks people");
    expect(describeActivity(a("alert", { rule: "jump", from: 52, to: 71, sent_to: [], failed: [{ email: "a@x.io", error: "Slack conversations.open: missing_scope" }] })).text)
      .toBe("alert: rising fast since yesterday; 1 Slack message couldn't be sent (reinstall the Slack app to allow direct messages)");
    expect(describeActivity(a("alert", { rule: "jump", from: 52, to: 71, sent_to: ["Thomas"], failed: [{ email: "b@x.io", error: "users_not_found" }, { email: "c@x.io", error: "users_not_found" }] })).text)
      .toBe("alert: rising fast since yesterday, sent to Thomas; 2 Slack messages couldn't be sent (users_not_found)");
    expect(describeActivity(a("diagnosis_started", { screen: "Messages › Message thread", via: "slack" })).text).toBe("ran diagnostics on Messages › Message thread from Slack");
    expect(describeActivity(a("diagnosis_ready", { cause: "The thread request times out." })).text).toBe("cause found: The thread request times out.");
    expect(describeActivity(a("diagnosis_started", { type: "new_feature", via: "web" })).text).toBe("started scoping");
    expect(describeActivity(a("diagnosis_ready", { type: "streamline", headline: "Drop the extra tap." })).text).toBe("steps mapped: Drop the extra tap.");
    expect(describeActivity(a("reporters_told", { names: ["Alex", "Leah"] })).text).toBe("told Alex and Leah in Slack that it shipped");
    expect(describeActivity(a("followups_drafted", { questions: ["Which screen?"] })).text).toBe("drafted follow-up questions");
    expect(describeActivity(a("followups_asked", { names: ["Alex"] })).text).toBe("asked Alex follow-up questions in Slack");
    expect(describeActivity(a("followup_answered", { name: "Alex", quote: "It's the calendar", filed: ["Week view slow to load"] })).text).toBe("Alex answered: It's the calendar (filed under Week view slow to load)");
    expect(describeActivity(a("retitled", { from: "A", to: "B" })).text).toBe("renamed");
    expect(describeActivity(a("assigned", { to: "me" })).text).toBe("assigned to me");
    expect(describeActivity(a("assigned", { to: null })).text).toBe("unassigned");
  });
  it("formats feedback arriving and Slack comments", () => {
    expect(describeActivity(a("feedback_added", { quote: "It reset to 3:00", author: "Sam", created: true })).text).toBe("reported by Sam: It reset to 3:00");
    expect(describeActivity(a("feedback_added", { quote: "Same here", author: null, created: false })).text).toBe("new feedback: Same here");
    expect(describeActivity(a("commented", { text: "Parents said this at pickup too", source: "slack", name: "Thomas" })).text).toBe("Thomas in Slack: Parents said this at pickup too");
    expect(describeActivity(a("commented", { text: "Noted" })).text).toBe("commented: Noted");
  });
  it("formats PR, draft, slack, viewed", () => {
    expect(describeActivity(a("pr_event", { action: "closed", by: "tom" })).text).toBe("PR closed by tom");
    expect(describeActivity(a("draft_dispatched", { solution: "Inline hint" })).text).toBe("draft dispatched: Inline hint");
    expect(describeActivity(a("slack_sent")).text).toBe("sent to Slack");
    expect(describeActivity(a("viewed")).text).toBe("viewed");
  });
  it("draft_failed carries a log link when present", () => {
    expect(describeActivity(a("draft_failed", { log_url: "https://x/log" }))).toEqual({ text: "draft failed", href: "https://x/log", linkLabel: "log" });
    expect(describeActivity(a("draft_failed"))).toEqual({ text: "draft failed" });
  });
  it("draft_ready links the PR only when it is https", () => {
    expect(describeActivity(a("draft_ready", { pr_url: "https://github.com/a/b/pull/3" }))).toEqual({ text: "draft ready", href: "https://github.com/a/b/pull/3", linkLabel: "PR" });
    expect(describeActivity(a("draft_ready", { pr_url: "javascript:alert(1)" }))).toEqual({ text: "draft ready" });
    expect(describeActivity(a("draft_ready"))).toEqual({ text: "draft ready" });
  });
  it("draft_skipped shows the reason", () => {
    expect(describeActivity(a("draft_skipped", { reason: "draft in progress" })).text).toBe("draft skipped: draft in progress");
    expect(describeActivity(a("draft_skipped")).text).toBe("draft skipped");
  });
  it("lane_action_failed shows its error in plain words, and slack_failed a truncated one", () => {
    expect(describeActivity(a("lane_action_failed", { lane: "quick_win", error: "boom" })).text).toBe("lane action failed: boom");
    // A failure's text is mapped to a plain sentence (lib/llm/errors.ts): a long raw message isn't shown.
    const long = describeActivity(a("lane_action_failed", { error: "e".repeat(500) })).text;
    expect(long).toBe("lane action failed: Something went wrong. Try again.");
    expect(describeActivity(a("slack_failed", { error: "403 invalid_token" })).text).toBe("Slack failed: 403 invalid_token");
    expect(describeActivity(a("slack_failed", { error: "x".repeat(200) })).text).toBe(`Slack failed: ${"x".repeat(120)}…`);
    expect(describeActivity(a("slack_failed")).text).toBe("Slack failed");
  });
  it("dismissed", () => expect(describeActivity(a("dismissed")).text).toBe("dismissed"));
  it("formats proposal authoring", () => {
    expect(describeActivity(a("proposal_added", { title: "Carpool list" })).text).toBe("added a proposal: Carpool list");
    expect(describeActivity(a("proposal_edited", { title: "Sent states" })).text).toBe("edited proposal: Sent states");
    expect(describeActivity(a("proposal_restored", { title: "Sent states" })).text).toBe("restored PMA's version: Sent states");
    expect(describeActivity(a("proposal_removed", { title: "Carpool list" })).text).toBe("removed proposal: Carpool list");
  });
  it("formats the review step and marks demo drafts", () => {
    expect(describeActivity(a("approved", { pr_url: "https://github.com/a/b/pull/3" }))).toEqual({ text: "approved and merged", href: "https://github.com/a/b/pull/3", linkLabel: "PR" });
    expect(describeActivity(a("approved", { demo: true }))).toEqual({ text: "approved and merged (demo)" });
    expect(describeActivity(a("changes_requested", { note: "Use a bigger button" })).text).toBe("requested changes: Use a bigger button");
    expect(describeActivity(a("draft_dispatched", { solution: "Inline hint", demo: true })).text).toBe("demo draft started: Inline hint");
    expect(describeActivity(a("draft_ready", { demo: true }))).toEqual({ text: "demo draft ready" });
  });
  it("falls back to kind with spaces", () => {
    expect(describeActivity(a("some_new_kind")).text).toBe("some new kind");
  });
});

describe("who said each quote", () => {
  const q = (speakers: string[], author: string | null = "Ms. Rivera") => ({ id: "q", quote: "x", speakers, source_id: "s", author, channel: "Parent coffee morning", at: "2026-10-15" });
  it("names the speaker when it isn't the person who added the source (recordings, Slack threads)", () => {
    expect(quoteSpeaker(q(["Tom Okafor"]))).toBe("Tom Okafor");
    expect(quoteSpeaker(q(["Priya Shah", "Elena Ruiz"]))).toBe("Priya Shah, Elena Ruiz");
  });
  it("stays quiet when the speaker is the source's author, or unknown", () => {
    expect(quoteSpeaker(q(["ms. rivera"]))).toBeNull();
    expect(quoteSpeaker(q([]))).toBeNull();
  });
  it("heads a group with the source alone when the quotes come from other people", () => {
    expect(sourceHeading({ author: "Ms. Rivera", channel: "Parent coffee morning", quotes: [q(["Tom Okafor"])] })).toBe("Parent coffee morning");
    expect(sourceHeading({ author: "Jordan", channel: "Support call", quotes: [q(["Jordan"], "Jordan")] })).toBe("Jordan in Support call");
    expect(sourceHeading({ author: null, channel: null, quotes: [q([], null)] })).toBe("Unknown in an upload");
  });
});
