// After a customer approves a mock-up (spec section 8 and call 11): how it gets built, the pull request that builds it,
// its preview, and when it counts as shipped. Pure, with no server imports: the issue page, the routes and the tests
// share these rules and this copy.
//
// Three ways to build an approved mock-up. The two pull-request ways are Build it (lib/build): PMA writes the change
// with Claude and commits it through the company's PMA GitHub App installation, so they need GitHub connected with
// the app's write permissions accepted (BuildCaps, worked out on the server). "Hand off to Claude Code" always works.

export type BuildMode = "new_pr" | "branch" | "claude_code";
export const BUILD_MODES: readonly BuildMode[] = ["new_pr", "branch", "claude_code"];

export const BUILD_QUESTION = "How should this be built?";
export const BUILD_OPTION: Record<BuildMode, { label: string; line: string }> = {
  new_pr: {
    label: "New pull request",
    line: "PMA builds it with Claude in a sandbox, using your company's Claude key, and opens a pull request on a fresh branch from your default branch. Nothing merges without your review.",
  },
  branch: {
    label: "Add to an existing branch",
    line: "PMA builds it the same way, but commits onto a branch you pick, on top of the code already there. Nothing merges without your review.",
  },
  claude_code: {
    label: "Hand off to Claude Code",
    line: "Your engineers get the task and the mock-up images, and build it with Claude Code themselves. With PMA connected to Claude Code, they can pull the task from there.",
  },
};
/** "Approved ..., to <verb>." */
export const BUILD_VERB: Record<BuildMode, string> = { new_pr: "open a new pull request", branch: "add it to an existing branch", claude_code: "hand off to Claude Code" };
/** What this company's GitHub connection allows: Build it needs an installation that accepted write access. */
export type BuildCaps = { githubConnected: boolean; githubWrite: boolean };
export const NO_CAPS: BuildCaps = { githubConnected: false, githubWrite: false };

/** Under each pull-request option when it can't be picked: what's missing. */
export const NEEDS_GITHUB_CONNECT = "Needs Connect with GitHub";
export const NEEDS_GITHUB_WRITE = "Needs the PMA app's new GitHub permissions";
export const prNeeds = (caps: BuildCaps) => (caps.githubConnected ? NEEDS_GITHUB_WRITE : NEEDS_GITHUB_CONNECT);
/** Once, under the two disabled options: why, and what to do meanwhile. */
export const prNeedsWhy = (caps: BuildCaps) => caps.githubConnected
  ? "PMA commits the change and opens the pull request through its GitHub App, which needs write access to contents and pull requests. Accept the app's new permissions on GitHub (the owner of the account it's installed on gets the request), or hand this one to Claude Code."
  : "PMA commits the change and opens the pull request through its GitHub App. Connect with GitHub in Settings, or hand this one to Claude Code.";
/** The API's answer when someone asks for a pull-request option it can't do. */
export const BUILD_UNAVAILABLE = "PMA can't open pull requests for this app yet: connect GitHub and accept the PMA app's write permissions, or hand it off to Claude Code.";

/** Whether PMA can build this way for this company: Claude Code always; a pull request with write access on GitHub. */
export function buildModeAvailable(mode: BuildMode, caps: BuildCaps = NO_CAPS): boolean {
  return mode === "claude_code" || caps.githubWrite;
}

export function parseBuildMode(v: unknown): BuildMode | null {
  return typeof v === "string" && (BUILD_MODES as readonly string[]).includes(v) ? (v as BuildMode) : null;
}

/** The default the company saved for this app (projects.settings.build.mode), or null when none is saved. */
export function savedBuildMode(settings: unknown): BuildMode | null {
  const build = settings && typeof settings === "object" ? (settings as { build?: unknown }).build : null;
  return parseBuildMode(build && typeof build === "object" ? (build as { mode?: unknown }).mode : null);
}

/** The branch saved with an "Add to an existing branch" default, or null. */
export function savedBuildBranch(settings: unknown): string | null {
  const build = settings && typeof settings === "object" ? (settings as { build?: unknown }).build : null;
  const b = build && typeof build === "object" ? (build as { branch?: unknown }).branch : null;
  return typeof b === "string" && b.trim() ? b.trim() : null;
}

/** How an approval builds when nobody picks: the saved default if PMA can build that way for this company, else
 *  Claude Code. A saved branch default needs its branch too. */
export function defaultBuildMode(settings: unknown, caps: BuildCaps = NO_CAPS): BuildMode {
  const saved = savedBuildMode(settings);
  if (saved === "branch" && !savedBuildBranch(settings)) return "claude_code";
  return saved && buildModeAvailable(saved, caps) ? saved : "claude_code";
}

/** projects.settings with the build default replaced (with its branch, for "Add to an existing branch"), keeping every other key. */
export function withBuildDefault(settings: unknown, mode: BuildMode, branch?: string | null): Record<string, unknown> {
  const base = settings && typeof settings === "object" && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {};
  return { ...base, build: mode === "branch" && branch ? { mode, branch } : { mode } };
}

// ---- Pull requests -------------------------------------------------------------------------------------------------

const OWNER = "[A-Za-z0-9][A-Za-z0-9-]{0,38}";
const REPO = "[A-Za-z0-9._-]{1,100}";
/** A pull request's page, or one of its tabs (/files, /commits/<sha>), with an optional query or hash. */
const PR_URL = new RegExp(`^(?:https?://)?(?:www\\.)?github\\.com/(${OWNER})/(${REPO})/pull/([1-9][0-9]{0,9})(?:/[A-Za-z0-9/_-]*)?(?:[?#].*)?$`, "i");
const INT_MAX = 2_147_483_647;

export const PR_URL_INVALID = "Paste a GitHub pull request link, like https://github.com/acme/web-app/pull/42.";
export const PR_NEEDS_REPO = "Connect your repository in Settings first, so PMA can check the pull request belongs to it.";
/** A repository name can end in "." (acme/Closet.), so a full stop never follows one directly. */
export const prWrongRepo = (repo: string) => `That pull request isn't in the repository this app is connected to (${repo}).`;
export const PR_ALREADY_LINKED = "That pull request is already linked to this issue.";
export const PREVIEW_INVALID = "The preview link must be a full https:// address, like https://my-app-git-fix.vercel.app.";
export const LINK_FORBIDDEN = "Only company owners and admins, or the person who owns this issue, can link a pull request.";
export const SHIP_FORBIDDEN = "Only company owners and admins can mark an issue shipped.";
export const SHIP_NEEDS_PR = "Link the pull request first. An issue ships when its pull request merges.";
export const SHIP_NOT_READY = "Only an issue that is ready to build can be marked shipped.";
/** Mark as shipped on an issue that shipped meanwhile: its pull request merged on GitHub (the PMA GitHub App's webhook
 *  ships it on its own) or someone else marked it while the page was open. The page refreshes to show it shipped. */
export const SHIP_ALREADY = "This issue has shipped already: its pull request merged on GitHub, or someone else marked it.";
/** One line beside the Mark as shipped button, which notifies the reporters: when to press it, and who hears. */
export const SHIP_NOTE = "Once it has merged. Everyone who raised it in Slack is told it shipped.";
/** The sentence the Mark as shipped confirm asks. */
export const SHIP_CONFIRM = "Mark this as shipped? Do this once the pull request has merged. Everyone who raised it in Slack will be told it shipped.";

export type PullRequestRef = { owner: string; repo: string; number: number };

/** A GitHub pull request link, in any of the shapes people paste, or null. */
export function parsePullRequestUrl(input: unknown): PullRequestRef | null {
  if (typeof input !== "string") return null;
  const m = PR_URL.exec(input.trim());
  if (!m) return null;
  const [, owner, repo, n] = m;
  const number = Number(n);
  if (/^\.+$/.test(repo) || !Number.isSafeInteger(number) || number > INT_MAX) return null;
  return { owner, repo, number };
}

/**
 * Checks a pasted link against the app's connected repository. The stored link uses the app's spelling of the
 * repository, so one pull request is one row however it was pasted.
 */
export function checkPullRequestUrl(input: unknown, appRepo: string | null | undefined):
  { ok: true; url: string; repo: string; number: number } | { ok: false; error: string } {
  const pr = parsePullRequestUrl(input);
  if (!pr) return { ok: false, error: PR_URL_INVALID };
  if (!appRepo) return { ok: false, error: PR_NEEDS_REPO };
  if (`${pr.owner}/${pr.repo}`.toLowerCase() !== appRepo.toLowerCase()) return { ok: false, error: prWrongRepo(appRepo) };
  return { ok: true, url: `https://github.com/${appRepo}/pull/${pr.number}`, repo: appRepo, number: pr.number };
}

/** An optional preview link (their Vercel or Netlify preview): empty is null; anything else must be plain https. */
export function parsePreviewUrl(input: unknown): { ok: true; url: string | null } | { ok: false; error: string } {
  if (input == null) return { ok: true, url: null };
  if (typeof input !== "string") return { ok: false, error: PREVIEW_INVALID };
  const t = input.trim();
  if (!t) return { ok: true, url: null };
  let u: URL;
  try { u = new URL(t); } catch { return { ok: false, error: PREVIEW_INVALID }; }
  if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".") || u.href.length > 500) return { ok: false, error: PREVIEW_INVALID };
  return { ok: true, url: u.href };
}

// ---- Where an approved mock-up stands --------------------------------------------------------------------------------

export type PullRequestLink = { id: string; url: string; repo: string; number: number; state: string; preview_url: string | null; linked_by_email: string | null; created_at: string };
type Activity = { kind: string; payload: Record<string, unknown> | null; at: string };

/** The issue's latest Build it attempt (lib/build), as the page reads it. */
export type BuildView = {
  id: string; mode: "new_pr" | "branch"; status: "queued" | "running" | "opened" | "failed"; steps: string[]; files: string[];
  error: string | null; pr_url: string | null; pr_number: number | null; head_branch: string | null; base_branch: string | null; created_at: string; updated_at: string;
};
export const BUILDING = "PMA is building it with Claude. The pull request shows up here when it's open.";
export const BUILD_FAILED = "The build didn't finish. Try again, or hand it to Claude Code.";

export type BuildProgress = {
  /** When the approximate mock-up was approved (the latest approval), or null. */
  approvedAt: string | null;
  /** How the approval said to build it. */
  mode: BuildMode;
  /** Someone copied or downloaded the task since the approval. */
  handedOff: boolean;
  /** Newest first. */
  pullRequests: PullRequestLink[];
  /** The newest preview link on any linked pull request. */
  preview: string | null;
  shipped: boolean;
  /** The latest Build it attempt, when it was built (or is being built) that way. */
  build: BuildView | null;
  /** What happens next: hand it off, wait for the pull request, PMA building it (or its build failed), ship it, or
   *  nothing (shipped). */
  next: "hand_off" | "link_pr" | "building" | "build_failed" | "ship" | "done";
};

/** Where an approved mock-up stands, from the issue's status, its activity and its linked pull requests. */
export function buildProgress(i: { status: string; activity: Activity[]; pull_requests: PullRequestLink[]; build?: BuildView | null }): BuildProgress {
  const approval = [...i.activity].filter((a) => a.kind === "approved" && a.payload?.approximate).sort((x, y) => y.at.localeCompare(x.at))[0] ?? null;
  const approvedAt = approval?.at ?? null;
  const handedOff = !!approvedAt && i.activity.some((a) => a.kind === "handed_off" && a.at >= approvedAt);
  const pullRequests = [...i.pull_requests].sort((x, y) => y.created_at.localeCompare(x.created_at));
  const preview = pullRequests.find((p) => p.preview_url)?.preview_url ?? null;
  const shipped = i.status === "shipped";
  const mode = parseBuildMode(approval?.payload?.build) ?? "claude_code";
  // Built (or being built) by PMA: the latest attempt since the approval decides, until a pull request is linked.
  const build = i.build && (!approvedAt || i.build.created_at >= approvedAt) ? i.build : null;
  const building = !pullRequests.length && (build ? build.status !== "opened" : mode !== "claude_code");
  const next = shipped ? "done" : pullRequests.length ? "ship" : building ? (build?.status === "failed" ? "build_failed" : "building") : handedOff ? "link_pr" : "hand_off";
  return { approvedAt, mode, handedOff, pullRequests, preview, shipped, build, next };
}

/** "Pull request #42", as the page names one. */
export const prName = (p: { number: number }) => `Pull request #${p.number}`;
