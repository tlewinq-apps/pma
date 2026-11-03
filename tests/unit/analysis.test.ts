import { describe, it, expect } from "vitest";
import { analyseIssue, audienceCount, bestFlow, feeling, firstSentence, fixBand, flowsWith, outOf10, placeOnFlow, urgencyWord, type AnalysisInput } from "@/lib/analysis";
import { reportStats, scoreUrgency } from "@/lib/urgency";
import { DEFAULT_WEIGHTS } from "@/lib/types";
import { DEMO_PROFILE, profileOf } from "@/lib/product/profile";
import { peopleWords } from "@/lib/proposals";

const NOW = Date.parse("2026-10-16T10:00:00Z");

/** "Class messages fail to load", as the demo seed stores it (scripts/demo/snapshot.ts). */
const classMessages = (): AnalysisInput => ({
  type: "bug", ease: 77, peopleCount: 1,
  breakdown: {
    severity: 5, clarity: 4, scope: "single_screen", reach: 1, mappingConfidence: 0.88, peopleCount: 1,
    rationale: {
      severity: "Parents cannot read any class messages, which blocks the core job of staying informed.",
      clarity: "The failure and the expected behaviour are clear, but there are no error details or steps to reproduce it.",
      scope: "Likely a load fix on the thread screen, though a server cause can't be ruled out.",
    },
    inputs: { severity: 5, reach: 1, peopleCount: 1, meanSentiment: -1.5, frustrated: true, lastReportAt: "2026-10-15T14:20:00Z", distinctPeople: 1, reportedByOthers: 0 },
    signals: { blocks_task: 1, has_workaround: 0, data_loss: 0, frequency_words: 0, of: 2 },
  },
  units: [
    { sentiment: -2, emotion: "frustrated", audience: "users", speakers: ["Jordan Lee"], signals: { blocks_task: true }, at: "2026-10-15T14:20:00Z", channel: "Support call" },
    { sentiment: -1, emotion: "frustrated", audience: "users", speakers: ["Jordan Lee"], signals: {}, at: "2026-10-15T14:20:00Z", channel: "Support call" },
  ],
  screens: [{ frame_id: "messages/thread", title: "Message thread", confidence: 0.88 }],
  finding: null, recommended: null,
});

describe("analyseIssue", () => {
  it("reads the demo bug as urgent, a core flow for members, and easy to fix", () => {
    const a = analyseIssue(classMessages(), NOW)!;
    // A blocker one person reported yesterday: 8.5 + 1.5 × log2(2)/log2(11) = 8.93.
    expect([a.urgency.score, a.stakeholders.score, a.fixability.score]).toEqual([9, 7, 8]);
    expect(a.urgency.word).toBe("Act this week");
    expect(a.stakeholders.word).toBe("Members on a core flow");
    expect(a.fixability.word).toBe("Easy: one screen");
    expect(a.verdict).toBe("Act this week: it blocks members on a core flow, and the fix looks small.");
  });

  it("keeps today's why-it-matters sentences as the reasons", () => {
    const a = analyseIssue(classMessages(), NOW)!;
    expect(a.urgency.reasons[0]).toEqual({ lead: "Blocker", text: "Parents cannot read any class messages, which blocks the core job of staying informed." });
    expect(a.urgency.reasons[1]).toEqual({ lead: "Blocks the task", text: "1 of 2 says it blocks them." });
    expect(a.urgency.reasons[2]).toEqual({ lead: "1 person in 30 days", text: "" });
    expect(a.urgency.reasons[3].lead).toBe("Last heard today");
    expect(a.stakeholders.reasons[0]).toEqual({ lead: "1 person", text: "Jordan Lee (Support call)." });
    expect(a.stakeholders.reasons[2]).toEqual({ lead: "Members", text: "Both pieces came from members." });
    expect(a.fixability.reasons.map((r) => r.lead)).toEqual(["One screen", "Specific", "Unconfirmed"]);
    expect(a.fixability.parts).toContainEqual({ label: "Screen match", value: "Strong match" });
  });

  it("credits the first step's finding and the recommended proposal", () => {
    const a = analyseIssue({ ...classMessages(), finding: { headline: "The thread request times out" }, recommended: { effort: "S", risk: "low" } }, NOW)!;
    expect(a.fixability.reasons).toContainEqual({ lead: "Cause found", text: "The thread request times out." });
    expect(a.fixability.reasons).toContainEqual({ lead: "Proposal", text: "Small effort, low risk." });
  });

  it("is null for an issue that hasn't been rated", () => {
    expect(analyseIssue({ ...classMessages(), breakdown: null }, NOW)).toBeNull();
  });

  it("reads urgency from the pieces and the stored people count on older ratings", () => {
    const i = classMessages();
    const a = analyseIssue({ ...i, breakdown: { ...i.breakdown!, inputs: undefined } }, NOW)!;
    expect(a.urgency.score).toBe(9);
    expect(a.stakeholders.reasons[0].lead).toBe("1 person");
  });

  it("works out ease from the rating when none is stored", () => {
    expect(analyseIssue({ ...classMessages(), ease: null }, NOW)!.fixability.score).toBe(8);
  });

  it("says it's unmatched when there's no screen", () => {
    const a = analyseIssue({ ...classMessages(), screens: [], breakdown: { ...classMessages().breakdown!, mappingConfidence: undefined } }, NOW)!;
    expect(a.fixability.parts).toContainEqual({ label: "Screen match", value: "None yet" });
  });

  it("fades urgency by when the pieces happened, whatever the project's weights", () => {
    const i = classMessages();
    // 60 days quiet: nobody in the last 30 days, and the fade at its floor of half: 8.5 × 0.5.
    const old = { ...i, units: i.units.map((u) => ({ ...u, at: "2026-08-17T10:00:00Z" })) };
    const recencyOnly = { ...DEFAULT_WEIGHTS, importance: { ...DEFAULT_WEIGHTS.importance, severity: 0, recency: 1 } };
    expect(analyseIssue(old, NOW)!.urgency.score).toBe(4);
    expect(analyseIssue({ ...old, weights: recencyOnly }, NOW)!.urgency.score).toBe(4);
    expect(analyseIssue(old, NOW)!.urgency.reasons.map((r) => r.lead)).toEqual(["Blocker", "Blocks the task", "Last heard 8 weeks ago"]);
  });

  it("counts the people of the last 30 days, and those they mentioned", () => {
    const i = classMessages();
    const a = analyseIssue({ ...i, units: [...i.units, { ...i.units[0], speakers: ["Priya"], reportedCount: 2, at: "2026-10-10T09:00:00Z" }] }, NOW)!;
    expect(a.urgency.reasons).toContainEqual({ lead: "4 people in 30 days", text: "2 people told us, plus 2 others they mentioned." });
  });

  it("says when it's rising this week", () => {
    const i = classMessages();
    const weekly = ["2026-09-17T10:00:00Z", "2026-09-24T10:00:00Z", "2026-10-01T10:00:00Z", "2026-10-08T10:00:00Z"].map((at) => ({ ...i.units[1], at }));
    const a = analyseIssue({ ...i, units: [...i.units, ...weekly, { ...i.units[1], at: "2026-10-16T08:00:00Z" }] }, NOW)!;
    expect(a.urgency.reasons.map((r) => r.lead)).toEqual(["Blocker", "Blocks the task", "1 person in 30 days", "Rising this week", "Last heard today"]);
    expect(a.urgency.reasons[3].text).toBe("3 reports this week; a usual week has 1.");
  });

  it("gives the Desk card the same urgency as Why it matters", () => {
    const i = classMessages();
    expect(scoreUrgency(i.breakdown!.inputs!.severity, reportStats(i.units, NOW), NOW).score).toBe(analyseIssue(i, NOW)!.urgency.score);
  });

  it("phrases a feature request as people asking for it", () => {
    const i = classMessages();
    const a = analyseIssue({
      ...i, type: "new_feature", ease: 40, peopleCount: 3, units: ["Jordan Lee", "Priya", "Tom"].map((name) => ({ ...i.units[1], speakers: [name] })),
      breakdown: { ...classMessages().breakdown!, severity: 2, reach: 0.5, inputs: { ...classMessages().breakdown!.inputs!, severity: 2, reach: 0.5, peopleCount: 3, distinctPeople: 3 } },
    }, NOW)!;
    expect(a.fixability.name).toBe("Ease to build");
    expect(a.verdict).toBe("When there's room: 3 members ask for it on an occasional flow, and it's a real build.");
  });

  it("names a mix of audiences", () => {
    const i = classMessages();
    const a = analyseIssue({ ...i, units: [...i.units, { ...i.units[0], audience: "staff", speakers: ["Ms. Rivera"] }] }, NOW)!;
    expect(a.stakeholders.word).toBe("Members and staff on a core flow");
    expect(a.stakeholders.reasons).toContainEqual({ lead: "Mixed", text: "2 members and 1 staff member." });
  });
});

// The same issue read for a customer app: Why it matters counts people in the words the issue header uses
// (peopleWords: "1 shopper"), and the demo keeps "1 person" exactly as before.
describe("a customer app's audience words", () => {
  const closet = profileOf({ kind: "customer", name: "Closet", product_profile: { name: "Closet", one_liner: "an AI fashion app", audience: "shoppers", audience_one: "shopper", platform: "web" } });
  const undescribed = profileOf({ kind: "customer", name: "Closet", product_profile: null });
  /** One shopper's two pieces: the Closet issue that said "1 person" under a "1 shopper" header. */
  const shopper = (profile: AnalysisInput["profile"], audience: string | null = "users"): AnalysisInput => {
    const i = classMessages();
    return { ...i, profile, units: i.units.map((u) => ({ ...u, audience, speakers: ["Sam"] })) };
  };
  const people = (a: NonNullable<ReturnType<typeof analyseIssue>>) => ({
    urgency: a.urgency.reasons.find((r) => /in 30 days$/.test(r.lead))?.lead,
    stakeholders: a.stakeholders.reasons[0].lead,
    part: a.stakeholders.parts.find((p) => p.label === "People")?.value,
  });

  it("says shopper where the header says shopper", () => {
    const a = analyseIssue(shopper(closet), NOW)!;
    expect(peopleWords(1, ["users"], closet)).toBe("1 shopper");
    expect(people(a)).toEqual({ urgency: "1 shopper in 30 days", stakeholders: "1 shopper", part: "1 shopper" });
    expect(a.stakeholders.reasons).toContainEqual({ lead: "Shoppers", text: "Both pieces came from shoppers." });
    expect(JSON.stringify(a)).not.toMatch(/1 person/);
  });

  it("uses the plural for several, and for those they mentioned", () => {
    const i = shopper(closet);
    const more = { ...i, peopleCount: 4, units: [...i.units, { ...i.units[0], speakers: ["Priya"], reportedCount: 2, at: "2026-10-10T09:00:00Z" }],
      breakdown: { ...i.breakdown!, inputs: { ...i.breakdown!.inputs!, distinctPeople: 2, reportedByOthers: 2, peopleCount: 4 } } };
    const a = analyseIssue(more, NOW)!;
    expect(a.urgency.reasons).toContainEqual({ lead: "4 shoppers in 30 days", text: "2 shoppers told us, plus 2 others they mentioned." });
    expect(a.stakeholders.reasons[0].lead).toBe("2 shoppers, plus 2 others they mentioned");
  });

  it("falls back to the stored people count on older ratings, in the same words", () => {
    const i = shopper(closet);
    const a = analyseIssue({ ...i, breakdown: { ...i.breakdown!, inputs: undefined } }, NOW)!;
    expect(a.stakeholders.reasons[0].lead).toBe("1 shopper");
  });

  it("says person and people for an app that isn't described yet", () => {
    expect(people(analyseIssue(shopper(undescribed), NOW)!)).toEqual({ urgency: "1 person in 30 days", stakeholders: "1 person", part: "1 person" });
  });

  it("says staff member when only staff raised it, as the header does", () => {
    expect(people(analyseIssue(shopper(closet, "staff"), NOW)!).part).toBe("1 staff member");
  });

  it("names the shoppers asking for a feature when nobody's audience is known", () => {
    const i = shopper(closet, null);
    const three = { ...i, type: "new_feature" as const, ease: 40, peopleCount: 3,
      breakdown: { ...i.breakdown!, severity: 2, reach: 0.5, inputs: { ...i.breakdown!.inputs!, severity: 2, reach: 0.5, peopleCount: 3, distinctPeople: 3 } } };
    const asking = (input: AnalysisInput) => analyseIssue(input, NOW)!.verdict.replace(/^[^:]+: /, "");
    expect(asking(three)).toBe("3 shoppers ask for it on an occasional flow, and it's a real build.");
    expect(asking({ ...three, profile: undescribed })).toBe("3 people ask for it on an occasional flow, and it's a real build.");
    // Known audiences keep their own noun.
    expect(asking({ ...three, units: three.units.map((u) => ({ ...u, audience: "users" })) })).toBe("3 shoppers ask for it on an occasional flow, and it's a real build.");
    expect(asking({ ...three, units: three.units.map((u) => ({ ...u, audience: "staff" })) })).toBe("3 staff members ask for it on an occasional flow, and it's a real build.");
  });

  it("counts the demo's people as members, and says person without a profile", () => {
    const base = classMessages();
    const without = analyseIssue(base, NOW)!;
    const withDemo = analyseIssue({ ...base, profile: DEMO_PROFILE }, NOW)!;
    expect(people(without)).toEqual({ urgency: "1 person in 30 days", stakeholders: "1 person", part: "1 person" });
    expect(people(withDemo)).toEqual({ urgency: "1 member in 30 days", stakeholders: "1 member", part: "1 member" });
    expect(withDemo.verdict).toBe("Act this week: it blocks members on a core flow, and the fix looks small.");
    expect(withDemo.verdict).toBe(without.verdict);
  });
});

describe("firstSentence", () => {
  it("keeps the first sentence and clips a runaway one at a word", () => {
    expect(firstSentence("The request times out. Logging is in place.")).toBe("The request times out.");
    expect(firstSentence("No full stop here")).toBe("No full stop here.");
    const long = firstSentence(`${"word ".repeat(60)}end.`, 40);
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(41);
  });
});

describe("bands", () => {
  it("turns scores into words at the edges", () => {
    expect([10, 8, 7, 6, 5, 4, 3, 0].map(urgencyWord)).toEqual(["Act this week", "Act this week", "Plan for soon", "Plan for soon", "When there's room", "When there's room", "Can wait", "Can wait"]);
    expect([8, 7, 6, 5, 4, 3].map(fixBand)).toEqual(["Easy", "Moderate", "Moderate", "Takes work", "Takes work", "Hard"]);
    expect([outOf10(-1), outOf10(0.74), outOf10(2)]).toEqual([0, 7, 10]);
  });
  it("counts people in the right noun", () => {
    expect([audienceCount("users", 1), audienceCount("staff", 2), audienceCount(null, 3)]).toEqual(["1 member", "2 staff members", "3 people"]);
  });
});

describe("feeling", () => {
  it("reads two frustrated complaints", () => {
    const f = feeling(classMessages().units)!;
    expect(f.word).toBe("Frustrated");
    expect(f.text).toBe("Both pieces are negative, and both sound frustrated.");
    expect(f.buckets.map((b) => b.count)).toEqual([1, 1, 0, 0, 0]);
  });
  it("describes a mix", () => {
    const f = feeling([{ sentiment: -2, emotion: "frustrated" }, { sentiment: 0, emotion: "neutral" }, { sentiment: 2, emotion: "delighted" }])!;
    expect(f.text).toBe("1 of 3 is negative, 1 positive, and 1 sounds frustrated, 1 neutral and 1 delighted.");
    expect(f.emotions.map((e) => e.emotion)).toEqual(["frustrated", "neutral", "delighted"]);
  });
  it("is null with nothing to read", () => expect(feeling([])).toBeNull());
});

describe("flows", () => {
  const flows = [
    { board: "flow-message-the-school", title: "Message the school", frames: ["home/index", "messages/inbox", "messages/thread", "messages/compose"], position: 1 },
    { board: "flow-read-a-message", title: "Read a message", frames: ["home/index", "messages/thread"], position: 4 },
    { board: "flow-early-pickup", title: "Early pickup", frames: ["home/index", "pickup/notify"], position: 2 },
  ];
  it("prefers the most overlap, then the shorter flow", () => {
    expect(bestFlow(flows, ["messages/thread"])?.board).toBe("flow-read-a-message");
    expect(bestFlow(flows, ["messages/inbox", "messages/thread"])?.board).toBe("flow-message-the-school");
    expect(bestFlow(flows, ["settings/index"])).toBeNull();
    expect(flowsWith(flows, ["messages/thread"])).toBe(2);
  });
  it("places the most confident screen on its step", () => {
    const p = placeOnFlow(flows, [{ frame_id: "home/index", title: "Home", confidence: 0.8 }, { frame_id: "pickup/notify", title: "Early pickup", confidence: 0.94 }])!;
    expect(p.text).toBe("Early pickup, step 2 of 2 in Early pickup");
  });
  it("names a screen that starts every flow as the start of them", () => {
    expect(placeOnFlow(flows, [{ frame_id: "home/index", title: "Home", confidence: 0.7 }])!.text).toBe("Home, where 3 flows start");
  });
  it("breaks a confidence tie toward the later step", () => {
    const p = placeOnFlow(flows, [{ frame_id: "home/index", title: "Home", confidence: 0.9 }, { frame_id: "messages/thread", title: "Message thread", confidence: 0.9 }])!;
    expect(p.text).toBe("Message thread, step 2 of 2 in Read a message");
  });
});
