import { describe, it, expect } from "vitest";
import { decodeMeta, encodeMeta, permalink, ref, unref } from "@/lib/slack/ids";

const issueId = "0b9e6a3c-1d2f-4a5b-8c7d-9e0f1a2b3c4d";
const solutionId = "f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b";

describe("button values", () => {
  it("round-trips one or two ids", () => {
    expect(unref(ref(issueId), 1)).toEqual([issueId]);
    expect(unref(ref(issueId, solutionId), 2)).toEqual([issueId, solutionId]);
  });
  it("rejects the wrong count or anything that is not a UUID", () => {
    expect(unref(ref(issueId, solutionId), 1)).toBeNull();
    expect(unref(ref(issueId), 2)).toBeNull();
    expect(unref("not-a-uuid", 1)).toBeNull();
    expect(unref(`${issueId}:x`, 2)).toBeNull();
    expect(unref(`${issueId}'; drop table issues;--`, 1)).toBeNull();
    expect(unref(undefined, 1)).toBeNull();
    expect(unref(42, 1)).toBeNull();
  });
});

describe("modal private_metadata", () => {
  it("round-trips and validates", () => {
    expect(decodeMeta(encodeMeta({ issueId, solutionId }))).toEqual({ issueId, solutionId });
    expect(decodeMeta(encodeMeta({ issueId, draftId: solutionId }))).toEqual({ issueId, draftId: solutionId });
    expect(decodeMeta(encodeMeta({ issueId }))).toEqual({ issueId });
    expect(decodeMeta("{}")).toBeNull();
    expect(decodeMeta("not json")).toBeNull();
    expect(decodeMeta(JSON.stringify({ issueId: "x" }))).toBeNull();
    expect(decodeMeta(JSON.stringify({ issueId, solutionId: "x" }))).toBeNull();
  });
});

describe("permalink", () => {
  it("builds a message link from the workspace URL, channel and ts", () => {
    expect(permalink("https://acme.slack.com/", "C0123", "1760000000.001200")).toBe("https://acme.slack.com/archives/C0123/p1760000000001200");
    expect(permalink("https://acme.slack.com", "C0123", "1760000000.001200")).toBe("https://acme.slack.com/archives/C0123/p1760000000001200");
  });
});
