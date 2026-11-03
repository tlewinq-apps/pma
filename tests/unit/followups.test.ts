import { describe, it, expect, vi } from "vitest";
import { DEMO_PROFILE } from "@/lib/product/profile";
import { draftFollowups } from "@/lib/followups";

describe("draftFollowups", () => {
  const issue = { title: "App is weird", problem: "A parent says the app is weird sometimes.", quotes: ["the app is weird sometimes"] };
  it("asks the model for one or two short questions, from the issue and its quotes", async () => {
    const llm = vi.fn(async () => ({ questions: ["  What were you trying to do when it felt weird?  ", "Which screen were you on?"] }));
    expect(await draftFollowups(llm as never, issue, DEMO_PROFILE)).toEqual(["What were you trying to do when it felt weird?", "Which screen were you on?"]);
    const call = (llm.mock.calls as unknown as [{ user: string; effort: string }][])[0][0];
    expect(call.user).toContain("the app is weird sometimes");
    expect(call.effort).toBe("low");
  });
  it("keeps at most two and drops empty ones", async () => {
    const llm = vi.fn(async () => ({ questions: ["", "One?", "Two?", "Three?"] }));
    expect(await draftFollowups(llm as never, issue, DEMO_PROFILE)).toEqual(["One?", "Two?"]);
  });
});
