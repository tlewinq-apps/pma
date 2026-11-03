import { describe, it, expect } from "vitest";
import { durationLabel, filterSources, sourceKind, statusGroup, summarizeSource } from "@/lib/sources/summary";

const titles = new Map([["i1", "Early pickup fails silently"], ["i2", "Calendar export"], ["i3", "Absence report"]]);
const unit = (issue_id: string | null, type = "bug") => ({ issue_id, type });

describe("summarizeSource", () => {
  it("says what a finished source became, in words", () => {
    const units = [unit("i1"), unit("i1"), unit("i2", "new_feature"), unit("i3"), unit(null, "praise"), unit(null, "irrelevant"), unit(null, "question")];
    expect(summarizeSource({ status: "done", kind: "file", rawTextEmpty: false, error: null }, units, titles, new Set()))
      .toBe("4 pieces of feedback, filed under 3 issues, 1 piece of praise, 2 set aside");
  });

  it("names the one issue a source joined or started", () => {
    const src = { status: "done", kind: "slack", rawTextEmpty: false, error: null };
    expect(summarizeSource(src, [unit("i1")], titles, new Set())).toBe("Joined Early pickup fails silently");
    expect(summarizeSource(src, [unit("i1"), unit("i1")], titles, new Set(["i1"]))).toBe("Started Early pickup fails silently, 2 pieces of feedback");
  });

  it("says when nothing actionable was found", () => {
    expect(summarizeSource({ status: "done", kind: "paste", rawTextEmpty: false, error: null }, [unit(null, "irrelevant")], titles, new Set()))
      .toBe("Nothing to act on, 1 set aside");
    expect(summarizeSource({ status: "done", kind: "paste", rawTextEmpty: false, error: null }, [], titles, new Set())).toBe("Nothing to act on");
  });

  it("describes work in progress and failures", () => {
    expect(summarizeSource({ status: "queued", kind: "paste", rawTextEmpty: false, error: null }, [], titles, new Set())).toBe("Waiting to be read");
    expect(summarizeSource({ status: "processing", kind: "paste", rawTextEmpty: false, error: null }, [], titles, new Set())).toBe("Reading");
    expect(summarizeSource({ status: "processing", kind: "audio", rawTextEmpty: true, error: null }, [], titles, new Set())).toBe("Transcribing");
    expect(summarizeSource({ status: "failed", kind: "paste", rawTextEmpty: false, error: "no text found" }, [], titles, new Set())).toBe("Couldn't read: no text found");
  });

  it("explains setup errors instead of showing the raw SDK message", () => {
    const failed = (error: string) => summarizeSource({ status: "failed", kind: "audio", rawTextEmpty: false, error }, [], titles, new Set());
    expect(failed('Could not resolve authentication method. Expected one of apiKey, authToken, credentials, config, or profile to be set.')).toBe("Couldn't read: PMA needs an Anthropic API key (ANTHROPIC_API_KEY) to read feedback");
    expect(failed("Missing env VOYAGE_API_KEY")).toBe("Couldn't read: Missing env VOYAGE_API_KEY");
  });
});

describe("statusGroup and sourceKind", () => {
  it("groups statuses into what the person needs to know", () => {
    expect(["queued", "processing", "failed", "done"].map(statusGroup)).toEqual(["working", "working", "needs_you", "done"]);
  });

  it("names the kind a person would recognise", () => {
    expect(sourceKind({ kind: "audio", channel: null })).toBe("recording");
    expect(sourceKind({ kind: "file", channel: null })).toBe("document");
    expect(sourceKind({ kind: "paste", channel: "API" })).toBe("api");
    expect(sourceKind({ kind: "paste", channel: "Support call" })).toBe("pasted");
    expect(sourceKind({ kind: "slack", channel: "Slack #pma" })).toBe("slack");
    expect(sourceKind({ kind: "widget", channel: "In-app widget" })).toBe("widget");
    expect(sourceKind({ kind: "granola", channel: null })).toBe("other");
  });
});

describe("filterSources", () => {
  const rows = [
    { id: "a", kind: "audio", channel: null, status: "processing" },
    { id: "b", kind: "slack", channel: "Slack #pma", status: "done" },
    { id: "c", kind: "file", channel: null, status: "failed" },
  ];
  it("keeps everything with no filters", () => expect(filterSources(rows, {}).map((r) => r.id)).toEqual(["a", "b", "c"]));
  it("filters by status group and kind together", () => {
    expect(filterSources(rows, { status: "working" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterSources(rows, { kind: "document" }).map((r) => r.id)).toEqual(["c"]);
    expect(filterSources(rows, { status: "done", kind: "recording" })).toEqual([]);
  });
  it("ignores unknown filter values", () => expect(filterSources(rows, { status: "nope", kind: "nope" })).toHaveLength(3));
});

describe("durationLabel", () => {
  it("says how long a recording is in plain words", () => {
    expect(durationLabel(42)).toBe("Under a minute");
    expect(durationLabel(92)).toBe("2 minutes");
    expect(durationLabel(61)).toBe("1 minute");
    expect(durationLabel(3720)).toBe("1 hour 2 minutes");
    expect(durationLabel(null)).toBeNull();
  });
});
