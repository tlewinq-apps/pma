// Which draft a GitHub pull request event is about. Branch names are only unique per repository (two apps can both have
// a draft on pma/12-compare-ab12cd), so the lookup is filtered by the repository the event came from, joined through
// the draft's issue to its app's repo_full_name, in the query itself: another app's newer draft on the same branch name
// can't shadow the right one.
import type { SupabaseClient } from "@supabase/supabase-js";

export type PrDraft = { id: string; issue_id: string };

/** An exact, case-insensitive match for ILIKE: `_`, `%` and `\` are escaped (`_` is common in repository names). */
export function ilikeExact(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** The newest draft on `branch` whose app is connected to `repoFullName` (any case), or null. */
export async function draftForPullRequest(db: SupabaseClient, branch: string, repoFullName: string): Promise<PrDraft | null> {
  const { data, error } = await db.from("drafts")
    .select("id, issue_id, issues!inner(projects!inner(repo_full_name))")
    .eq("branch", branch)
    .ilike("issues.projects.repo_full_name", ilikeExact(repoFullName))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`draft lookup failed: ${error.message}`);
  if (!data) return null;
  // Belt and braces: the row's repo is the event's repo, compared exactly.
  const repo = (data as unknown as { issues: { projects: { repo_full_name: string | null } } }).issues?.projects?.repo_full_name;
  if (String(repo).toLowerCase() !== repoFullName.toLowerCase()) return null;
  return { id: data.id as string, issue_id: data.issue_id as string };
}
