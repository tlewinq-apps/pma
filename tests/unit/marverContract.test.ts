// The Marver connection without Marver: the fixture design folder, the dispatch payload the GitHub Action reads,
// and the callback the mock runner sends must all match what the real pieces expect.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { FIXTURE_DESIGN } from "@/lib/marver/fixture.generated";
import { fixtureReader } from "@/lib/marver/reader";
import { extractCopy, parseManifest } from "@/lib/marver/manifest";
import { DRAFT_PAYLOAD_FIELDS, DraftPayload } from "@/lib/drafts/payload";
import { buildMockCallback, mockPrUrl, proposalOf } from "@/lib/drafts/mockRunner";
import { parseCallbackBody, validShotPath } from "@/lib/drafts/callback";
import { draftBackend } from "@/lib/drafts/demo";
import { SCREENS } from "../../scripts/demo/celeste";

const issueId = "0b9e6a3c-1d2f-4a5b-8c7d-9e0f1a2b3c4d";
const draftId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const payload = {
  draft_id: draftId, branch: "pma/NF-12-early-pickup-a1b2c3", mode: "variant", target_frames: ["pickup/notify"], issue_short_id: "NF-12",
  title: "Early pickup fails silently", problem: "Send shows a spinner then returns Home.", type: "bug", solution: "Explicit sent / failed states",
  quotes: ["It never sent"], issue_url: `https://v.app/issues/${issueId}`, callback_url: "https://v.app/api/drafts/callback", callback_token: "t".repeat(48),
  upload_slots: Array.from({ length: 4 }, (_, k) => ({ path: `${issueId}/${draftId}/slot-${k}.png`, url: `https://storage/slot-${k}` })),
};

describe("fixture design folder", () => {
  const frames = parseManifest(JSON.parse(FIXTURE_DESIGN["design/manifest.json"]));
  it("has a live frame for every seeded Celeste screen", () => {
    expect(frames.map((f) => f.id).sort()).toEqual(SCREENS.map((s) => s.frame_id).sort());
  });
  it("ships every frame file, and each one has copy the screen mapper can read", () => {
    for (const f of frames) {
      expect(FIXTURE_DESIGN[f.file], f.file).toBeTruthy();
      expect(extractCopy(FIXTURE_DESIGN[f.file]).length, f.file).toBeGreaterThan(20);
    }
  });
  it("reads files through the same reader seam as GitHub", async () => {
    const r = fixtureReader();
    expect(await r.read("design/manifest.json")).toBe(FIXTURE_DESIGN["design/manifest.json"]);
    expect(await r.read("design/nope.tsx")).toBeNull();
  });
});

describe("dispatch payload contract with the GitHub Action", () => {
  it("contains every field the workflow and collect-shots.mjs read", () => {
    const yml = readFileSync("github-template/pma-draft.yml", "utf8");
    const mjs = readFileSync("github-template/collect-shots.mjs", "utf8");
    const fromYml = yml.split("\n").filter((l) => l.includes('<<<"$P"')).flatMap((l) => [...l.matchAll(/(?:\\\(|jq -r '?)\.([a-z_]+)/g)].map((m) => m[1]));
    const fromMjs = [...mjs.matchAll(/\bP\.([a-z_]+)/g)].map((m) => m[1]);
    const used = [...new Set([...fromYml, ...fromMjs])];
    expect(used.length).toBeGreaterThan(8);
    for (const f of used) expect(DRAFT_PAYLOAD_FIELDS, f).toContain(f);
  });
  it("validates a real-shaped payload", () => {
    expect(DraftPayload.parse(payload)).toEqual(payload);
  });
});

describe("mock runner callback", () => {
  const shots = { before: [{ frame_id: "pickup/notify", path: payload.upload_slots[0].path }], after: [{ frame_id: "pickup/notify", path: payload.upload_slots[1].path }] };
  const mockPrefix = "https://v.app/mock/pr/";

  it("passes the callback check only when the draft is a mock draft", () => {
    const body = buildMockCallback(payload, shots, "https://v.app");
    expect(body.pr_url).toBe(mockPrUrl("https://v.app", draftId));
    expect(parseCallbackBody(body, { mockPrefix }).ok).toBe(true);
    expect(parseCallbackBody(body).ok).toBe(false);
    expect(body.marver_paths).toEqual(["design/scenes/pickup/notify.tsx"]);
  });
  it("only uses the upload slots minted for this draft", () => {
    const body = buildMockCallback(payload, shots, "https://v.app");
    for (const s of [...body.before!, ...body.after!]) expect(validShotPath(s.path, issueId, draftId)).toBe(true);
  });
  it("still accepts real GitHub callbacks", () => {
    expect(parseCallbackBody({ draft_id: draftId, token: "x", status: "ready", pr_url: "https://github.com/o/r/pull/1" }).ok).toBe(true);
    expect(parseCallbackBody({ draft_id: draftId, token: "x", status: "ready", pr_url: "https://evil.example/pull/1" }, { mockPrefix }).ok).toBe(false);
  });
});

describe("draftBackend", () => {
  it("picks the mock runner when asked, GitHub when connected, and the demo renderer otherwise", () => {
    const demo = (repo: string | null) => ({ kind: "demo", repo_full_name: repo });
    expect(draftBackend(demo("o/r"), "tok", "mock")).toBe("mock");
    expect(draftBackend(demo(null), undefined, "mock")).toBe("mock");
    expect(draftBackend(demo("o/r"), "tok", undefined)).toBe("github");
    expect(draftBackend(demo("o/r"), undefined, undefined)).toBe("demo");
    expect(draftBackend(demo(null), "tok", "")).toBe("demo");
    expect(draftBackend({ kind: "customer", repo_full_name: "o/r" }, "tok", undefined)).toBe("demo");
  });
});

describe("proposalOf", () => {
  it("reads the proposal back out of the payload's solution text", () => {
    expect(proposalOf("Explicit sent / failed states: Keep the parent on the form until the send resolves.")).toEqual({ title: "Explicit sent / failed states", summary: "Keep the parent on the form until the send resolves." });
    expect(proposalOf("Edit window: Show Edit for 15 minutes.\n\nReviewer note: make the button bigger")).toEqual({ title: "Edit window", summary: "Show Edit for 15 minutes. Reviewer note: make the button bigger" });
    expect(proposalOf("Just a title")).toEqual({ title: "Just a title", summary: "" });
  });
});

describe("mock runner when the callback is unreachable", () => {
  it("marks the draft failed itself instead of leaving it in Drafting", async () => {
    const { runMockDraft } = await import("@/lib/drafts/mockRunner");
    const post = vi.fn(async () => { throw new Error("connect ECONNREFUSED"); });
    const markFailed = vi.fn(async () => {});
    await runMockDraft({ ...payload, target_frames: [] }, { delayMs: 0, post, markFailed, loadScreens: async () => [] });
    expect(post).toHaveBeenCalledTimes(2); // the ready callback, then the failed one
    expect(markFailed).toHaveBeenCalledWith(draftId, expect.stringContaining("ECONNREFUSED"));
  });
  it("doesn't touch the draft directly when the callback goes through", async () => {
    const { runMockDraft } = await import("@/lib/drafts/mockRunner");
    const post = vi.fn(async () => {});
    const markFailed = vi.fn(async () => {});
    await runMockDraft({ ...payload, target_frames: [] }, { delayMs: 0, post, markFailed, loadScreens: async () => [] });
    expect(post).toHaveBeenCalledTimes(1);
    expect(markFailed).not.toHaveBeenCalled();
  });
});
