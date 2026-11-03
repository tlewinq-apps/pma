// The GitHub webhook's draft lookup (src/lib/github/prDraft.ts) against the dev database. Branch names are unique only
// per repository, so another company's newer draft on the same branch must never shadow the right one: the repository
// filter runs in the query (through issues -> projects.repo_full_name), not after picking the newest row.
import { afterAll, beforeAll, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { draftForPullRequest } from "@/lib/github/prDraft";
import { admin, cleanup, makeApp, makeUser, type App } from "./harness";

let A: App, B: App;
const suffix = randomBytes(3).toString("hex");
const repoA = `rls-acme-${suffix}/my_app`;
const repoB = `rls-acme-${suffix}/myXapp`; // what "my_app" matches if "_" were left as an ILIKE wildcard
const branch = `pma/1-pickup-${suffix}`;

async function draft(issueId: string, createdAt: string): Promise<string> {
  const r = await admin().from("drafts")
    .insert({ issue_id: issueId, mode: "variant", branch, callback_token: randomBytes(16).toString("hex"), created_at: createdAt })
    .select("id").single();
  if (r.error) throw new Error(`insert draft: ${r.error.message}`);
  return r.data.id as string;
}

let olderInA: string, newerInB: string;
beforeAll(async () => {
  const [a, b] = await Promise.all([makeUser("pr-a"), makeUser("pr-b")]);
  [A, B] = await Promise.all([makeApp(a), makeApp(b)]);
  for (const [app, repo] of [[A, repoA], [B, repoB]] as const) {
    const r = await admin().from("projects").update({ repo_full_name: repo }).eq("id", app.appId);
    if (r.error) throw new Error(`set repo: ${r.error.message}`);
  }
  olderInA = await draft(A.issueId, "2026-10-01T10:00:00Z");
  newerInB = await draft(B.issueId, "2026-10-02T10:00:00Z"); // newest on the branch, but another company's repo
}, 60_000);
afterAll(cleanup, 60_000); // deleting the issues removes their drafts

it("finds the draft of the app connected to the event's repository, though another app has a newer draft on that branch", async () => {
  expect(await draftForPullRequest(admin(), branch, repoA)).toEqual({ id: olderInA, issue_id: A.issueId });
});

it("matches the repository without regard to case", async () => {
  expect(await draftForPullRequest(admin(), branch, repoA.toUpperCase())).toEqual({ id: olderInA, issue_id: A.issueId });
});

it("control: the other app's repository finds the other app's draft", async () => {
  expect(await draftForPullRequest(admin(), branch, repoB)).toEqual({ id: newerInB, issue_id: B.issueId });
});

it("finds nothing for a repository no app is connected to, or a branch with no draft", async () => {
  expect(await draftForPullRequest(admin(), branch, `rls-nobody-${suffix}/my_app`)).toBeNull();
  expect(await draftForPullRequest(admin(), `${branch}-nope`, repoA)).toBeNull();
});
