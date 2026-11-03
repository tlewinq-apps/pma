// Connect to Marver (src/lib/marver/connect.ts): where the canvas is, with the app's repository and design/ as the
// defaults, and a check that its manifest parses and has live frames before anything is saved.
import { describe, expect, it, vi } from "vitest";
import { fakeSnap } from "./fixtures/closetRepo";

vi.mock("@/lib/repo/snapshot", async (orig) => ({ ...(await orig<typeof import("@/lib/repo/snapshot")>()), unreadableReason: async () => "repo_private" }));

import { canvasLocation, canvasPathProblem, checkCanvas } from "@/lib/marver/connect";

const app = { repo_full_name: "acme/Closet.", watched_branch: "main" };
const manifest = (frames: { id: string; scene: string }[]) => JSON.stringify({ frames: frames.map((f) => ({ ...f, file: `design/scenes/${f.id}.tsx`, kind: "tsx" })) });

describe("where the canvas is", () => {
  it("defaults to the app's repository, its branch and design/", () => {
    expect(canvasLocation({}, app)).toEqual({ repo: "acme/Closet.", branch: "main", path: "design" });
  });

  it("takes another repository and folder, without the app's branch", () => {
    expect(canvasLocation({ repo: "acme/design-canvas", path: "canvas/" }, app)).toEqual({ repo: "acme/design-canvas", branch: null, path: "canvas" });
  });

  it("refuses bad repositories, branches and folders", () => {
    expect(canvasLocation({}, { repo_full_name: null, watched_branch: null })).toEqual({ error: expect.stringMatching(/Connect your repository first/) });
    expect(canvasLocation({ repo: "not a repo" }, app)).toEqual({ error: "Use owner/name, for example acme/web-app." });
    expect(canvasLocation({ branch: "main; rm -rf" }, app)).toEqual({ error: "That branch name isn't valid." });
    for (const path of ["../secrets", "/etc", "design/../x", "a//b"]) expect(canvasPathProblem(path), path).not.toBeNull();
    expect(canvasPathProblem("apps/web/design")).toBeNull();
  });
});

describe("checking the canvas", () => {
  const loc = { repo: "acme/Closet.", branch: "main", path: "design" };

  it("counts live frames, leaving out archived, proposal and component frames", async () => {
    const snap = fakeSnap({ "design/manifest.json": manifest([
      { id: "home/index", scene: "home" }, { id: "studio/look", scene: "studio" },
      { id: "home/old", scene: "home-v2" }, { id: "pma-x/a", scene: "pma-x" }, { id: "components/button", scene: "components" },
    ]) });
    expect(await checkCanvas(loc, async () => snap)).toEqual({ ok: true, frames: 2 });
  });

  it("says what to do when there's no canvas, a broken manifest or no frames", async () => {
    expect(await checkCanvas(loc, async () => fakeSnap({}))).toEqual({ ok: false, error: expect.stringMatching(/no design\/manifest\.json .*npx marver init/) });
    // The repository's name ends in "." here, so no punctuation may follow it directly.
    const missing = await checkCanvas(loc, async () => fakeSnap({}));
    expect(missing.ok ? "" : missing.error).toContain("in acme/Closet. yet.");
    expect(missing.ok ? "" : missing.error).not.toMatch(/Closet\.[.;,:]/);
    expect(await checkCanvas(loc, async () => fakeSnap({ "design/manifest.json": "{nope" }))).toEqual({ ok: false, error: "design/manifest.json isn't valid JSON." });
    expect(await checkCanvas(loc, async () => fakeSnap({ "design/manifest.json": manifest([]) }))).toEqual({ ok: false, error: expect.stringMatching(/no frames yet/) });
  });

  it("says plainly when the repository can't be read", async () => {
    expect(await checkCanvas(loc, async () => null)).toEqual({ ok: false, error: expect.stringMatching(/can't read that repository/) });
  });
});
