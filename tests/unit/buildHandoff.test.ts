// After a customer approves a mock-up: "How should this be built?", the pull request that builds it, its preview, and
// when it counts as shipped (lib/handoff/build.ts), with the page's words for each step (nextStep, the activity, the
// tour). Pure: no database, no network.
import { describe, expect, it } from "vitest";
import {
  BUILD_MODES, BUILD_OPTION, buildModeAvailable, buildProgress, checkPullRequestUrl, defaultBuildMode, NEEDS_GITHUB_CONNECT, NEEDS_GITHUB_WRITE, parseBuildMode, prNeeds, savedBuildBranch,
  parsePreviewUrl, parsePullRequestUrl, PR_NEEDS_REPO, PR_URL_INVALID, PREVIEW_INVALID, prWrongRepo, savedBuildMode, SHIP_CONFIRM, withBuildDefault,
  type PullRequestLink,
} from "@/lib/handoff/build";
import { nextStep, PR_LINKED_SHIP, PR_LINKED_WAIT, READY_TO_BUILD, WAITING_FOR_PR } from "@/lib/nextStep";
import { describeActivity } from "@/lib/queries/issueHelpers";
import { tourCard, type TourState } from "@/lib/tour/steps";

describe("How should this be built?", () => {
  it("offers three ways; the pull-request ones once the company's GitHub installation can write", () => {
    expect(BUILD_MODES).toEqual(["new_pr", "branch", "claude_code"]);
    expect(BUILD_MODES.map((m) => BUILD_OPTION[m].label)).toEqual(["New pull request", "Add to an existing branch", "Hand off to Claude Code"]);
    expect(BUILD_MODES.filter((m) => buildModeAvailable(m))).toEqual(["claude_code"]);
    expect(BUILD_MODES.filter((m) => buildModeAvailable(m, { githubConnected: true, githubWrite: false }))).toEqual(["claude_code"]);
    expect(BUILD_MODES.filter((m) => buildModeAvailable(m, { githubConnected: true, githubWrite: true }))).toEqual(["new_pr", "branch", "claude_code"]);
    expect(prNeeds({ githubConnected: false, githubWrite: false })).toBe(NEEDS_GITHUB_CONNECT);
    expect(prNeeds({ githubConnected: true, githubWrite: false })).toBe(NEEDS_GITHUB_WRITE);
    expect(BUILD_OPTION.new_pr.line).toMatch(/fresh branch from your default branch/);
    expect(BUILD_OPTION.new_pr.line).toMatch(/Nothing merges without your review/);
    expect(BUILD_OPTION.branch.line).toMatch(/branch you pick/);
    expect(BUILD_OPTION.claude_code.line).toMatch(/task and the mock-up images/);
  });

  it("follows the owner's copy rules: no arrows, middle dots or all-caps labels", () => {
    const words = BUILD_MODES.flatMap((m) => [BUILD_OPTION[m].label, BUILD_OPTION[m].line]).concat(NEEDS_GITHUB_CONNECT, NEEDS_GITHUB_WRITE, SHIP_CONFIRM);
    for (const w of words) {
      expect(w).not.toMatch(/→|·/);
      expect(w).not.toMatch(/\b[A-Z]{4,}\b/);
    }
  });

  it("reads the app's saved default (with its branch), and falls back to Claude Code for anything PMA can't build for this company", () => {
    const write = { githubConnected: true, githubWrite: true };
    expect(defaultBuildMode({ build: { mode: "new_pr" } }, write)).toBe("new_pr");
    expect(defaultBuildMode({ build: { mode: "branch", branch: "feature/x" } }, write)).toBe("branch");
    expect(defaultBuildMode({ build: { mode: "branch" } }, write)).toBe("claude_code"); // no branch saved
    expect(savedBuildBranch({ build: { mode: "branch", branch: " feature/x " } })).toBe("feature/x");
    expect(savedBuildBranch({ build: { mode: "new_pr" } })).toBeNull();
    expect(parseBuildMode("claude_code")).toBe("claude_code");
    expect(parseBuildMode("ship_it")).toBeNull();
    expect(savedBuildMode({ build: { mode: "branch" } })).toBe("branch");
    expect(savedBuildMode(null)).toBeNull();
    expect(savedBuildMode({ build: "claude_code" })).toBeNull();
    expect(defaultBuildMode({})).toBe("claude_code");
    expect(defaultBuildMode({ build: { mode: "new_pr" } })).toBe("claude_code");
    expect(defaultBuildMode({ build: { mode: "claude_code" } })).toBe("claude_code");
  });

  it("saves the default without touching the app's other settings", () => {
    expect(withBuildDefault({ other: 1, build: { mode: "new_pr" } }, "claude_code")).toEqual({ other: 1, build: { mode: "claude_code" } });
    expect(withBuildDefault(null, "claude_code")).toEqual({ build: { mode: "claude_code" } });
    expect(withBuildDefault([1], "claude_code")).toEqual({ build: { mode: "claude_code" } });
    expect(withBuildDefault({ other: 1 }, "branch", "feature/x")).toEqual({ other: 1, build: { mode: "branch", branch: "feature/x" } });
    expect(withBuildDefault({}, "new_pr", "feature/x")).toEqual({ build: { mode: "new_pr" } });
  });
});

describe("pull request links", () => {
  it("reads the shapes people paste", () => {
    for (const url of [
      "https://github.com/acme/web-app/pull/42",
      "https://github.com/acme/web-app/pull/42/",
      "https://github.com/acme/web-app/pull/42/files",
      "https://github.com/acme/web-app/pull/42/commits/abc123",
      "https://github.com/acme/web-app/pull/42?w=1#discussion",
      "github.com/acme/web-app/pull/42",
      "  https://www.github.com/acme/web-app/pull/42  ",
    ]) expect(parsePullRequestUrl(url), url).toEqual({ owner: "acme", repo: "web-app", number: 42 });
  });

  it("refuses anything that isn't a GitHub pull request", () => {
    for (const url of [
      "https://github.com/acme/web-app/issues/42", "https://github.com/acme/web-app", "https://gitlab.com/acme/web-app/pull/42",
      "https://github.com.evil.com/acme/web-app/pull/42", "https://evil.com/github.com/acme/web-app/pull/42", "https://github.com/acme/../pull/1",
      "https://github.com/acme/web-app/pull/0", "https://github.com/acme/web-app/pull/99999999999", "javascript:alert(1)", "", 42, null,
    ]) expect(parsePullRequestUrl(url), String(url)).toBeNull();
  });

  it("must be in the app's connected repository, and is stored in the app's spelling", () => {
    expect(checkPullRequestUrl("https://github.com/ACME/Web-App/pull/7/files", "acme/web-app")).toEqual({ ok: true, url: "https://github.com/acme/web-app/pull/7", repo: "acme/web-app", number: 7 });
    expect(checkPullRequestUrl("https://github.com/other/web-app/pull/7", "acme/web-app")).toEqual({ ok: false, error: prWrongRepo("acme/web-app") });
    expect(checkPullRequestUrl("nope", "acme/web-app")).toEqual({ ok: false, error: PR_URL_INVALID });
    expect(checkPullRequestUrl("https://github.com/acme/web-app/pull/7", null)).toEqual({ ok: false, error: PR_NEEDS_REPO });
  });

  it("handles a repository whose name ends in a full stop, without a sentence ending on it", () => {
    expect(checkPullRequestUrl("https://github.com/acme/Closet./pull/3", "acme/Closet.")).toMatchObject({ ok: true, url: "https://github.com/acme/Closet./pull/3" });
    expect(prWrongRepo("acme/Closet.")).not.toMatch(/\.\.$/);
  });

  it("takes an optional https preview link and nothing else", () => {
    expect(parsePreviewUrl("")).toEqual({ ok: true, url: null });
    expect(parsePreviewUrl(undefined)).toEqual({ ok: true, url: null });
    expect(parsePreviewUrl(" https://my-app-git-fix.vercel.app ")).toEqual({ ok: true, url: "https://my-app-git-fix.vercel.app/" });
    for (const bad of ["http://my-app.vercel.app", "javascript:alert(1)", "https://user:pw@my-app.vercel.app", "https://localhost", "not a url", `https://a.com/${"x".repeat(600)}`, 5]) {
      expect(parsePreviewUrl(bad), String(bad)).toEqual({ ok: false, error: PREVIEW_INVALID });
    }
  });
});

describe("where an approved mock-up stands", () => {
  const approved = { kind: "approved", payload: { approximate: true, build: "claude_code" }, at: "2026-10-17T10:00:00.000Z" };
  const pr = (over: Partial<PullRequestLink> = {}): PullRequestLink => ({ id: "l1", url: "https://github.com/a/b/pull/1", repo: "a/b", number: 1, state: "open", preview_url: null, linked_by_email: null, created_at: "2026-10-17T12:00:00.000Z", ...over });

  it("goes from the hand-off, to waiting for the pull request, to shipping it, to done", () => {
    expect(buildProgress({ status: "ready_to_build", activity: [approved], pull_requests: [] })).toMatchObject({ next: "hand_off", handedOff: false, mode: "claude_code", approvedAt: approved.at });
    const handed = { kind: "handed_off", payload: { via: "copy" }, at: "2026-10-17T11:00:00.000Z" };
    expect(buildProgress({ status: "ready_to_build", activity: [handed, approved], pull_requests: [] }).next).toBe("link_pr");
    expect(buildProgress({ status: "ready_to_build", activity: [handed, approved], pull_requests: [pr()] }).next).toBe("ship");
    // A pull request linked without a recorded hand-off still moves it on.
    expect(buildProgress({ status: "ready_to_build", activity: [approved], pull_requests: [pr()] }).next).toBe("ship");
    expect(buildProgress({ status: "shipped", activity: [approved], pull_requests: [pr({ state: "merged" })] })).toMatchObject({ next: "done", shipped: true });
  });

  it("counts only hand-offs since the latest approval, and shows the newest preview", () => {
    const before = { kind: "handed_off", payload: { via: "copy" }, at: "2026-10-17T09:00:00.000Z" };
    expect(buildProgress({ status: "ready_to_build", activity: [approved, before], pull_requests: [] }).handedOff).toBe(false);
    const p = buildProgress({ status: "ready_to_build", activity: [approved], pull_requests: [pr({ id: "old", preview_url: "https://old.vercel.app/", created_at: "2026-10-17T11:00:00.000Z" }), pr({ id: "new", preview_url: "https://new.vercel.app/" })] });
    expect(p.pullRequests.map((x) => x.id)).toEqual(["new", "old"]);
    expect(p.preview).toBe("https://new.vercel.app/");
  });
});

describe("the page's words for each step", () => {
  const base = { stage: "ready_to_build" as const, unaskedQuestions: false, slackReporters: 1, recommendedHasScreens: false, othersToTell: 0, backend: "mock", approximate: true };

  it("says what the team does next at Ready to build", () => {
    expect(nextStep({ ...base, build: { next: "hand_off", mayShip: true } })).toBe(`${READY_TO_BUILD.lead}${READY_TO_BUILD.action}${READY_TO_BUILD.tail}`);
    expect(nextStep({ ...base, build: { next: "link_pr", mayShip: true } })).toBe(WAITING_FOR_PR);
    expect(nextStep({ ...base, build: { next: "ship", mayShip: true } })).toBe(PR_LINKED_SHIP);
    expect(nextStep({ ...base, build: { next: "ship", mayShip: false } })).toBe(PR_LINKED_WAIT);
    expect(WAITING_FOR_PR).toBe("Waiting for the pull request. Link it here once your engineers open it.");
  });

  it("names each step in the activity", () => {
    expect(describeActivity({ kind: "approved", payload: { approximate: true, build: "claude_code" } }).text).toBe("approved the mock-up, to hand off to Claude Code");
    expect(describeActivity({ kind: "handed_off", payload: { via: "copy" } }).text).toBe("copied the task for Claude Code");
    expect(describeActivity({ kind: "handed_off", payload: { via: "download" } }).text).toBe("downloaded the task for Claude Code, with the mock-up images");
    expect(describeActivity({ kind: "handed_off", payload: { via: "mcp" } }).text).toBe("task pulled into Claude Code through PMA's MCP server");
    expect(describeActivity({ kind: "pr_linked", payload: { pr_number: 42, pr_url: "https://github.com/a/b/pull/42" } })).toEqual({ text: "linked pull request #42", href: "https://github.com/a/b/pull/42", linkLabel: "PR" });
    expect(describeActivity({ kind: "pr_linked", payload: { pr_number: 42, pr_url: "javascript:alert(1)" } })).toEqual({ text: "linked pull request #42" });
    expect(describeActivity({ kind: "preview_added", payload: { pr_number: 42, preview_url: "https://x.vercel.app/" } })).toMatchObject({ text: "added a preview of pull request #42", href: "https://x.vercel.app/" });
    expect(describeActivity({ kind: "pr_unlinked", payload: { pr_number: 42 } }).text).toBe("removed the link to pull request #42");
    expect(describeActivity({ kind: "shipped", payload: { manual: true, pr_number: 42, pr_url: "https://github.com/a/b/pull/42" } })).toMatchObject({ text: "marked it shipped (pull request #42)", href: "https://github.com/a/b/pull/42" });
  });
});

describe("the tour on a customer app's approximate mock-up", () => {
  const state: TourState = { v: 1, issueId: "i1", title: "Look is cut off", type: "bug", step: 7, status: "active" };
  const input = { state, base: "/acme/web", path: "/issues/i1", slackJoined: null, hasInvite: false, email: null };

  it("asks to approve the mock-up, not to ship it", () => {
    const card = tourCard({ ...input, stage: "review", approximate: true })!;
    expect(card.body).toMatch(/Approve the mock-up/);
    expect(card.body).not.toMatch(/Approve to ship it/);
    expect(card.body).not.toMatch(/Create full flow/);
  });

  it("control: the demo's review card is unchanged", () => {
    expect(tourCard({ ...input, stage: "review" })!.body).toBe("The changes are outlined in orange on the real screen. Approve to ship it, or Request changes with a note. Create full flow draws the whole journey if you want to see more.");
  });

  it("points Ready to build at the hand-off and the pull request", () => {
    const card = tourCard({ ...input, stage: "ready_to_build", approximate: true })!;
    expect(card.targets[0]).toBe("[data-handoff]");
    expect(card.body).toMatch(/link the pull request/);
  });
});
