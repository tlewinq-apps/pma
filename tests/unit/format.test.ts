import { describe, it, expect } from "vitest";
import { timeAgo, initials, statusLabel, peopleLabel, reachLabel, matchLabel, SCOPE_LABEL, SEVERITY_LABEL, impactLabel, EMOTION_LABEL, LANE_LABEL, TYPE_LABEL, RAIL_LABEL, feelingLabel, lastHeardLabel, peopleDetail, priorityBand, priorityTrendLabel, signalsLabel, joinNames } from "@/components/triage/format";

const EMOJI = /\p{Extended_Pictographic}/u;

describe("format", () => {
  it("keeps initials and status labels", () => {
    expect(initials("thomas.lewin@x.com")).toBe("TL");
    expect(statusLabel("draft_ready")).toBe("Ready for review");
  });
  it("describes people as a rounded count", () => {
    expect(peopleLabel(1)).toBe("1 person");
    expect(peopleLabel(1.5)).toBe("2 people");
    expect(peopleLabel(0)).toBe("0 people");
  });
  it("puts effort, severity and emotion into words", () => {
    expect(SCOPE_LABEL.copy).toBe("Copy change");
    expect(SCOPE_LABEL.single_screen).toBe("One screen");
    expect(SCOPE_LABEL.new_flow_backend).toBe("New flow + backend");
    expect(SEVERITY_LABEL[5]).toBe("Blocker");
    expect(impactLabel(4.6)).toBe("Blocker");
    expect(impactLabel(null)).toBeNull();
    expect(SEVERITY_LABEL[1]).toBe("Cosmetic");
    expect(EMOTION_LABEL.frustrated).toBe("Frustrated");
  });
  it("buckets reach and screen-match confidence", () => {
    expect(reachLabel(1)).toBe("Core flow");
    expect(reachLabel(0.6)).toBe("Common flow");
    expect(reachLabel(0.5)).toBe("Occasional flow"); // the rating rubric's "occasional" anchor
    expect(reachLabel(0.3)).toBe("Edge flow");
    expect(matchLabel(0.94)).toBe("Strong match");
    expect(matchLabel(0.5)).toBe("Likely match");
    expect(matchLabel(0.2)).toBe("Weak match");
  });
  it("uses plain lane words and no emoji anywhere", () => {
    expect(LANE_LABEL.explore).toBe("Needs a decision");
    for (const map of [LANE_LABEL, TYPE_LABEL, RAIL_LABEL, SCOPE_LABEL, EMOTION_LABEL]) for (const v of Object.values(map)) expect(v).not.toMatch(EMOJI);
  });
  it("says how long ago something happened", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    expect(timeAgo("2026-10-15T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2026-10-15T11:55:00Z", now)).toBe("5 min ago");
    expect(timeAgo("2026-10-15T09:00:00Z", now)).toBe("3 h ago");
    expect(timeAgo("2026-10-12T12:00:00Z", now)).toBe("3 d ago");
    expect(timeAgo("nope", now)).toBe("");
  });
});

describe("priority words", () => {
  it("bands priority by the project's thresholds", () => {
    expect([86, 60, 59, 35, 34, 0].map((n) => priorityBand(n))).toEqual(["High", "High", "Medium", "Medium", "Low", "Low"]);
    expect(priorityBand(50, { importanceHigh: 50, easeHigh: 70, watchMin: 20, watchRecentReports: 2 })).toBe("High");
  });
  it("says how strongly people feel", () => {
    expect(feelingLabel(-0.2, true)).toBe("Frustrated");
    expect(feelingLabel(-1.5, false)).toBe("Upset");
    expect(feelingLabel(-0.6, false)).toBe("Annoyed");
    expect(feelingLabel(0, false)).toBe("Matter-of-fact");
    expect(feelingLabel(0.6, false)).toBe("Interested");
    expect(feelingLabel(1.5, false)).toBe("Keen");
  });
  it("says when it was last heard", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    expect(lastHeardLabel("2026-10-15T09:00:00Z", now)).toBe("Last heard today");
    expect(lastHeardLabel("2026-10-14T09:00:00Z", now)).toBe("Last heard yesterday");
    expect(lastHeardLabel("2026-10-10T12:00:00Z", now)).toBe("Last heard 5 days ago");
    expect(lastHeardLabel("2026-09-20T12:00:00Z", now)).toBe("Last heard 3 weeks ago");
  });
  it("says how many people, and how many more were mentioned", () => {
    expect(peopleDetail(9, 0)).toBe("9 people");
    expect(peopleDetail(1, 2)).toBe("1 person, plus 2 others they mentioned");
    expect(peopleDetail(3, 1)).toBe("3 people, plus 1 other they mentioned");
  });
  it("puts the severity signals into a sentence, leaving out the ones nobody raised", () => {
    expect(signalsLabel({ blocks_task: 4, has_workaround: 2, data_loss: 0, frequency_words: 3, of: 6 })).toBe("4 of 6 say it blocks them · 2 have a workaround · 3 say it happens every time");
    expect(signalsLabel({ blocks_task: 1, has_workaround: 1, data_loss: 1, frequency_words: 0, of: 1 })).toBe("1 of 1 says it blocks them · 1 has a workaround · 1 lost data");
    expect(signalsLabel({ blocks_task: 0, has_workaround: 0, data_loss: 0, frequency_words: 0, of: 4 })).toBeNull();
  });
});

describe("priorityTrendLabel", () => {
  it("says how far priority moved in the last day, ignoring small wobbles", () => {
    expect(priorityTrendLabel({ from: 52, to: 71 })).toBe("Up 19 since yesterday");
    expect(priorityTrendLabel({ from: 80, to: 74 })).toBe("Down 6 since yesterday");
    expect(priorityTrendLabel({ from: 80, to: 82 })).toBeNull();
    expect(priorityTrendLabel(null)).toBeNull();
  });
});

describe("joinNames", () => {
  it("lists names the way a sentence would", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["Priya"])).toBe("Priya");
    expect(joinNames(["Priya", "Tom"])).toBe("Priya and Tom");
    expect(joinNames(["Priya", "Tom", "Ana"])).toBe("Priya, Tom and Ana");
  });
  it("reads an activity payload that isn't a list as no names", () => {
    expect(joinNames(undefined)).toBe("");
    expect(joinNames("Priya")).toBe("");
    expect(joinNames([1, "Tom"])).toBe("1 and Tom");
  });
});
