import { it, expect } from "vitest";
import { parseIssuePatch } from "@/lib/queries/issueDetail";
it("validates patches", () => {
  expect(parseIssuePatch({ assign: "me" })).toEqual({ assign: "me" });
  expect(parseIssuePatch({ type: "add_on", decision: "Ship variant B" })).toEqual({ type: "add_on", decision: "Ship variant B" });
  expect(parseIssuePatch({ type: "complaint" })).toEqual({ error: "invalid type" });
  expect(parseIssuePatch({ decision: "x".repeat(5001) })).toEqual({ error: "decision too long" });
});

it("validates title", () => {
  expect(parseIssuePatch({ title: "  New name  " })).toEqual({ title: "New name" });
  expect(parseIssuePatch({ title: "   " })).toEqual({ error: "invalid title" });
  expect(parseIssuePatch({ title: "" })).toEqual({ error: "invalid title" });
  expect(parseIssuePatch({ title: 5 })).toEqual({ error: "invalid title" });
  expect(parseIssuePatch({ title: "x".repeat(80) })).toEqual({ title: "x".repeat(80) });
  expect(parseIssuePatch({ title: "x".repeat(81) })).toEqual({ error: "invalid title" });
});
