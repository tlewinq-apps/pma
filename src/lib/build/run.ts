// Runs one Build it attempt (a builds row), across as many function invocations as it takes. Each invocation takes the
// build with a fresh lease, so two can never work on it at once: from the queue (or from a run that died, after six
// minutes), or from the invocation before it (the lease it handed over). It reads the repository at the base commit as
// the company's installation, lets Claude write the change (agent.ts), commits it, pushes the branch, opens or finds
// the pull request, links it to the issue and says so on the issue. Every failure ends as a sentence for the person.
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";
import { env } from "@/lib/env";
import { findConnection } from "@/lib/connections/store";
import { GithubAppError, installationGrant } from "@/lib/github/app";
import { canWrite } from "@/lib/github/install";
import { openRepo } from "@/lib/repo/snapshot";
import { callWithTools, NO_COMPANY_KEY, withAppClaude, type ToolCaller } from "@/lib/llm/client";
import { friendlyLlmError } from "@/lib/llm/errors";
import { appBase } from "@/lib/links";
import { BuildError, runBuildAgent, type AgentState } from "./agent";
import { loadBuildBrief } from "./brief";
import { branchSha, commitStaged, defaultBranchOf, fastForward, ghWith, openPullFor, openPullRequest, pullRequestBody, pushNewBranch } from "./commit";

/** How long one invocation works before handing over (Vercel stops a function at 300 s). */
export const RUN_BUDGET_MS = 250_000;
/** A run that has held its build this long without saving is taken to have died. */
export const STALE_MS = 6 * 60_000;
export const MAX_ATTEMPTS = 3;
const MAX_STEPS = 14;

export const NEEDS_GITHUB_WRITE = "PMA can't commit to this repository yet: accept the PMA GitHub App's new permissions (contents and pull requests: write) on GitHub, then try again.";
export const NEEDS_GITHUB = "Connect with GitHub first: Build it commits through the PMA GitHub App.";

type BuildRow = {
  id: string; issue_id: string; project_id: string; mode: "new_pr" | "branch"; base_branch: string | null; head_branch: string | null; base_sha: string | null;
  transcript: unknown; staged: unknown; turns: number; stalls: number; steps: unknown; started_by: string | null; lease: string | null;
};
const COLS = "id, issue_id, project_id, mode, base_branch, head_branch, base_sha, transcript, staged, turns, stalls, steps, started_by, lease";

class LeaseLost extends Error {}

/** Asks the deployment to run (or go on with) a build in a fresh invocation, after this response is sent. */
export function kickBuild(buildId: string, origin: string, lease: string | null = null): void {
  const go = async () => {
    const res = await fetch(`${origin}/api/cron/build`, {
      method: "POST", headers: { authorization: `Bearer ${env.cronSecret()}`, "content-type": "application/json" },
      body: JSON.stringify({ id: buildId, lease }), signal: AbortSignal.timeout(15_000),
    }).catch((e: Error) => e);
    if (!(res instanceof Response) || !res.ok) console.error("[build] hand-off failed; the cron sweep will pick it up", buildId, res instanceof Response ? res.status : res.message);
  };
  try { after(go); } catch { void go(); }
}

/** Takes the build for this invocation, or null when it isn't this invocation's to run. */
async function claim(db: SupabaseClient, buildId: string, handedLease: string | null): Promise<BuildRow | null> {
  const lease = randomUUID();
  const now = new Date().toISOString();
  if (handedLease) {
    const { data } = await db.from("builds").update({ lease, locked_at: now, updated_at: now }).eq("id", buildId).eq("status", "running").eq("lease", handedLease).select(COLS).maybeSingle();
    return data as BuildRow | null;
  }
  const { data: row } = await db.from("builds").select("status, attempts, locked_at").eq("id", buildId).maybeSingle();
  if (!row || (row.attempts as number) >= MAX_ATTEMPTS) return null;
  const stale = new Date(Date.now() - STALE_MS).toISOString();
  const queued = row.status === "queued";
  const died = row.status === "running" && (!row.locked_at || (row.locked_at as string) < stale);
  if (!queued && !died) return null;
  // Conditional on what was read, so of two invocations claiming at once only one gets it.
  let q = db.from("builds").update({ status: "running", lease, locked_at: now, updated_at: now, attempts: (row.attempts as number) + 1 })
    .eq("id", buildId).eq("attempts", row.attempts as number).eq("status", row.status as string);
  if (died && row.locked_at) q = q.lt("locked_at", stale);
  const { data } = await q.select(COLS).maybeSingle();
  return data as BuildRow | null;
}

const stepsOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

/** A failure, in words for the person: Build it's own sentences, the company-key wording for Claude, or GitHub's. */
export function buildErrorText(e: unknown): string {
  if (e instanceof BuildError) return e.message;
  if (e instanceof Error && e.message === NO_COMPANY_KEY) return NO_COMPANY_KEY;
  if (e instanceof GithubAppError) {
    if (e.status === 401 || e.status === 404) return "PMA couldn't reach the repository through your GitHub installation. Check the PMA app still has access to it, then try again.";
    if (e.status === 403) return NEEDS_GITHUB_WRITE;
    return "GitHub didn't answer as expected. Try again in a minute.";
  }
  return friendlyLlmError(e);
}

/**
 * Runs the build `buildId` for up to RUN_BUDGET_MS. "skipped": not this invocation's to run; "paused": handed to a
 * fresh invocation; "done": opened or failed. `origin` is this deployment, for the hand-over.
 */
export async function runBuild(buildId: string, o: { origin: string; lease?: string | null; db?: SupabaseClient; call?: ToolCaller; fetch?: typeof fetch; now?: () => number }): Promise<"skipped" | "paused" | "done"> {
  const db = o.db ?? serviceDb();
  const now = o.now ?? Date.now;
  const deadline = now() + RUN_BUDGET_MS;
  const row = await claim(db, buildId, o.lease ?? null);
  if (!row) return "skipped";
  let steps = stepsOf(row.steps);
  const lease = row.lease!;
  const write = async (fields: Record<string, unknown>, more: string[] = []) => {
    steps = [...steps, ...more].slice(-MAX_STEPS);
    const { data } = await db.from("builds").update({ ...fields, steps, updated_at: new Date().toISOString(), locked_at: new Date().toISOString() }).eq("id", buildId).eq("lease", lease).select("id");
    if (!data?.length) throw new LeaseLost();
  };

  try {
    const brief = await loadBuildBrief(row.issue_id, db);
    if (!brief) throw new BuildError("This issue or its approved proposal is gone, so there's nothing to build.");
    const { project } = brief;
    if (project.kind === "demo") throw new BuildError("The demo app doesn't build pull requests.");
    const repo = project.repo_full_name;
    if (!repo) throw new BuildError("Connect the app's repository first.");
    const conn = await findConnection("github", { orgId: project.org_id, projectId: null }, db);
    if (!conn?.external_id || (conn.status !== "ok" && conn.status !== "broken")) throw new BuildError(NEEDS_GITHUB);
    const grant = await installationGrant(conn.external_id, o.fetch);
    if (!canWrite(grant.permissions)) throw new BuildError(NEEDS_GITHUB_WRITE);
    const gh = ghWith(grant.token, o.fetch);

    // The base: the commit everything is built on, fixed on the first run so a resumed build reads the same code.
    if (!row.base_sha) {
      const defaultBranch = await defaultBranchOf(gh, repo);
      const base = row.mode === "new_pr" ? project.watched_branch || defaultBranch : row.head_branch;
      if (!base) throw new BuildError("Pick the branch to add the change to.");
      if (row.mode === "branch" && base === defaultBranch) throw new BuildError(`Build it doesn't commit straight to ${defaultBranch}, the default branch. Pick another branch, or open a new pull request.`);
      const sha = await branchSha(gh, repo, base);
      if (!sha) throw new BuildError(`There's no branch called ${base} in ${repo} any more.`);
      row.base_branch = base;
      row.base_sha = sha;
      await write({ base_branch: base, base_sha: sha }, [`Reading ${repo} at ${base}`]);
    }
    const snapshot = await openRepo({ repo_full_name: repo, watched_branch: row.base_sha, org_id: project.org_id }, { auth: { scope: project.org_id, token: grant.token }, fetch: o.fetch });
    if (!snapshot) throw new BuildError(`PMA couldn't read ${repo} at ${row.base_branch}.`);

    const state: AgentState = {
      transcript: Array.isArray(row.transcript) ? (row.transcript as AgentState["transcript"]) : [],
      staged: row.staged && typeof row.staged === "object" ? (row.staged as Record<string, string>) : {},
      turns: row.turns ?? 0,
      stalls: row.stalls ?? 0,
    };
    const outcome = await withAppClaude(project.id, () => runBuildAgent({
      brief: brief.content, snapshot, state, deadline, now, call: o.call ?? callWithTools,
      save: (s, more) => write({ transcript: s.transcript, staged: s.staged, turns: s.turns, stalls: s.stalls ?? 0 }, more),
    }));
    if (outcome.status === "paused") {
      // Hand over: the next invocation takes the build with this lease, then mints its own.
      kickBuild(buildId, o.origin, lease);
      return "paused";
    }

    const staged = new Map(Object.entries(outcome.state.staged));
    await write({}, [`Committing ${staged.size} ${staged.size === 1 ? "file" : "files"}`]);
    const short = brief.issue.short_id;
    const { sha, files } = await commitStaged(gh, {
      repo, baseSha: row.base_sha!, staged, original: (p) => snapshot.read(p),
      readable: new Set(snapshot.files().map((f) => f.path)),
      message: `${outcome.title}\n\nBuilt by PMA with Claude from the approved mock-up.\n\nPMA: ${short}`,
    });
    const issueUrl = `${env.appUrl().replace(/\/+$/, "")}${appBase(project.org_slug, project.slug)}/issues/${brief.issue.id}`;
    const body = pullRequestBody({ summary: outcome.summary, task: brief.task, issueUrl, short });
    let head: string;
    let pr;
    if (row.mode === "new_pr") {
      const { count } = await db.from("builds").select("id", { count: "exact", head: true }).eq("issue_id", row.issue_id);
      head = await pushNewBranch(gh, repo, `pma/${short.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}-build-${count ?? 1}`, sha);
      pr = await openPullRequest(gh, repo, { title: outcome.title, head, base: row.base_branch!, body });
    } else {
      head = row.head_branch!;
      await fastForward(gh, repo, head, sha);
      pr = (await openPullFor(gh, repo, head)) ?? (await openPullRequest(gh, repo, { title: outcome.title, head, base: await defaultBranchOf(gh, repo), body }));
    }

    // Linked to the issue in the app's spelling of the repository, like a pasted link (0040); a repeat is a no-op.
    const url = `https://github.com/${repo}/pull/${pr.number}`;
    const { error: linkError } = await db.from("pull_request_links").insert({ issue_id: row.issue_id, url, repo, number: pr.number, state: "open", linked_by: row.started_by });
    if (linkError && linkError.code !== "23505") console.error("[build] the pull request wasn't linked", buildId, linkError.message);
    await db.from("activity").insert({ issue_id: row.issue_id, user_id: row.started_by, kind: "build_opened", payload: { build_id: buildId, pr_url: url, pr_number: pr.number, files, branch: head } });
    await write({
      status: "opened", pr_url: url, pr_number: pr.number, commit_sha: sha, files, summary: outcome.summary.slice(0, 4000), head_branch: head,
      transcript: [], staged: {}, // the work is in the commit now; the row needn't keep it
    }, [`Pull request #${pr.number} opened`]);
    return "done";
  } catch (e) {
    if (e instanceof LeaseLost) return "skipped";
    const text = buildErrorText(e);
    if (!(e instanceof BuildError)) console.error("[build] failed", buildId, e instanceof Error ? e.message : e);
    await db.from("builds").update({ status: "failed", error: text, steps: [...steps, "Stopped"].slice(-MAX_STEPS), updated_at: new Date().toISOString() }).eq("id", buildId).eq("lease", lease);
    return "done";
  }
}
