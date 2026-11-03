import { describe, it, expect } from "vitest";
import { classifyEvent, slackToPlain, tsToIso } from "@/lib/slack/events";

const ctx = { inbox: "CINBOX", categoryChannels: new Set(["CBUGS", "CFEAT"]), botUserId: "UBOT" };
const msg = (o: Record<string, unknown>) => ({ type: "message", channel: "CINBOX", user: "U1", text: "Pickup resets to 3:00", ts: "100.1", ...o });

describe("classifyEvent", () => {
  it("ingests a top-level human message in #pma", () => {
    expect(classifyEvent(msg({}), ctx)).toEqual({ kind: "ingest", channel: "CINBOX", ts: "100.1", user: "U1", text: "Pickup resets to 3:00" });
  });
  it("hands a person's reply inside a front-door thread to the follow-up check (only answers to asked questions are kept)", () => {
    expect(classifyEvent(msg({ thread_ts: "99.0", text: "It was the pickup screen, every time" }), ctx)).toEqual({ kind: "reply", channel: "CINBOX", threadTs: "99.0", ts: "100.1", user: "U1", text: "It was the pickup screen, every time" });
    expect(classifyEvent(msg({ thread_ts: "99.0", bot_id: "B1" }), ctx).kind).toBe("ignore");
  });
  it("treats a reply in a category channel thread as a comment", () => {
    expect(classifyEvent(msg({ channel: "CBUGS", thread_ts: "50.5", ts: "101.0", text: "Seen this too" }), ctx))
      .toEqual({ kind: "comment", channel: "CBUGS", threadTs: "50.5", ts: "101.0", user: "U1", text: "Seen this too" });
    expect(classifyEvent(msg({ channel: "CBUGS", thread_ts: "50.5", ts: "101.0", subtype: "thread_broadcast" }), ctx).kind).toBe("comment");
  });
  it("ignores top-level posts in category channels (cards are the bot's)", () => {
    expect(classifyEvent(msg({ channel: "CBUGS" }), ctx).kind).toBe("ignore");
  });
  it("ignores bots, edits, deletions, joins, empty text and unknown channels", () => {
    expect(classifyEvent(msg({ bot_id: "B1" }), ctx).kind).toBe("ignore");
    expect(classifyEvent(msg({ user: "UBOT" }), ctx).kind).toBe("ignore");
    expect(classifyEvent(msg({ subtype: "message_changed" }), ctx).kind).toBe("ignore");
    expect(classifyEvent(msg({ subtype: "message_deleted" }), ctx).kind).toBe("ignore");
    expect(classifyEvent(msg({ subtype: "channel_join" }), ctx).kind).toBe("ignore");
    expect(classifyEvent(msg({ text: "   " }), ctx).kind).toBe("ignore");
    expect(classifyEvent(msg({ channel: "COTHER" }), ctx).kind).toBe("ignore");
    expect(classifyEvent({ type: "reaction_added" }, ctx).kind).toBe("ignore");
    expect(classifyEvent(null, ctx).kind).toBe("ignore");
  });
  it("keeps the text of a message with a file attached", () => {
    expect(classifyEvent(msg({ subtype: "file_share" }), ctx).kind).toBe("ingest");
  });
  it("opens the home tab", () => {
    expect(classifyEvent({ type: "app_home_opened", user: "U1", tab: "home" }, ctx)).toEqual({ kind: "home", user: "U1" });
    expect(classifyEvent({ type: "app_home_opened", user: "U1", tab: "messages" }, ctx).kind).toBe("ignore");
  });
  it("does nothing in #pma before setup", () => {
    expect(classifyEvent(msg({}), { ...ctx, inbox: null }).kind).toBe("ignore");
  });
});

describe("slackToPlain / tsToIso", () => {
  it("turns Slack markup into readable feedback text", () => {
    expect(slackToPlain("Hey <@U123> see <#C9|pickup-help> and <https://x.co/a|this page> or <https://y.co>. 3 &lt; 4 &amp;&amp; ok &gt;"))
      .toBe("Hey @someone see #pickup-help and this page (https://x.co/a) or https://y.co. 3 < 4 && ok >");
    expect(slackToPlain("<!here> it broke")).toBe("@here it broke");
  });
  it("converts a message ts to ISO time", () => {
    expect(tsToIso("1760000000.001200")).toBe("2025-10-09T08:53:20.001Z");
    expect(tsToIso("nope")).toBeNull();
  });
});
