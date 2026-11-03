import { describe, it, expect } from "vitest";
import { followupAskText, reportersToTell, shippedReplyText } from "@/lib/reporters";

const EMOJI = /\p{Extended_Pictographic}/u;
const slack = (id: string, user: string, ts: string, author = "Alex") => ({ source_id: id, kind: "slack", author, channel: "Slack #pma-feedback", metadata: { slack: { channel: "C1", ts, user } } });

describe("reportersToTell", () => {
  it("replies once per Slack message, and lists everyone else by name", () => {
    const r = reportersToTell([
      slack("s1", "U1", "1.1"), slack("s1", "U1", "1.1"), slack("s2", "U2", "2.2", "Leah"),
      { source_id: "w1", kind: "widget", author: "parent-0874", channel: "In-app widget", metadata: {} },
      { source_id: "a1", kind: "audio", author: "Ms. Rivera", channel: "Parent coffee morning", metadata: {} },
      { source_id: "a1", kind: "audio", author: "Ms. Rivera", channel: "Parent coffee morning", metadata: {} },
      { source_id: "x", kind: "slack", author: "Broken", channel: null, metadata: {} },
    ]);
    expect(r.slack).toEqual([
      { sourceId: "s1", channel: "C1", ts: "1.1", user: "U1", name: "Alex" },
      { sourceId: "s2", channel: "C1", ts: "2.2", user: "U2", name: "Leah" },
    ]);
    expect(r.others).toEqual([{ name: "parent-0874", where: "In-app widget" }, { name: "Ms. Rivera", where: "Parent coffee morning" }, { name: "Broken", where: "Slack" }]);
  });
});

describe("thread replies", () => {
  it("tells the reporter it shipped, by mention, with a link", () => {
    const t = shippedReplyText("U1", "Early pickup <fails>", "https://v.app/issues/1");
    expect(t).toBe("<@U1> This is fixed: <https://v.app/issues/1|Early pickup &lt;fails&gt;>. Thanks for raising it.");
    expect(t).not.toMatch(EMOJI);
  });
  it("asks the follow-up questions and says how to answer", () => {
    expect(followupAskText("U2", ["Which screen were you on?", "Does it happen every time?"])).toBe(
      "<@U2> A quick follow-up on what you raised:\n• Which screen were you on?\n• Does it happen every time?\nReply in this thread and it goes straight back to the team.",
    );
  });
});

describe("follow-up answers", () => {
  it("doesn't count an answer as a second reporter, so nobody is told twice in one thread", () => {
    const answer = { source_id: "s9", kind: "slack", author: "Alex", channel: "Slack #pma-feedback", metadata: { slack: { channel: "C1", ts: "1.5", user: "U1", reply_to: "1.1" } } };
    expect(reportersToTell([answer, slack("s1", "U1", "1.1")]).slack).toEqual([{ sourceId: "s1", channel: "C1", ts: "1.1", user: "U1", name: "Alex" }]);
  });
  it("still tells someone whose answer was filed under a different issue, in the original thread", () => {
    const answer = { source_id: "s9", kind: "slack", author: "Alex", channel: "Slack #pma-feedback", metadata: { slack: { channel: "C1", ts: "1.5", user: "U1", reply_to: "1.1" } } };
    expect(reportersToTell([answer]).slack).toEqual([{ sourceId: "s9", channel: "C1", ts: "1.1", user: "U1", name: "Alex" }]);
  });
});
