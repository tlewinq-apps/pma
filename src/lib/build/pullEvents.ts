// What a pull request on GitHub does to issues, from the PMA GitHub App's pull_request events. Only for the companies
// that hold the installation the event came from, and only their apps connected to that exact repository:
// - merged: its links become merged, and an issue that is Ready to build ships (markShipped, via GitHub), which tells
//   everyone who raised it;
// - closed without merging: its open links become closed; reopened: open again;
// - opened, edited or reopened with a "PMA: <short id>" line (Copy task puts it last; Build it too): the pull request
//   links itself to that issue, while the issue is Ready to build.
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";
import { markShipped } from "@/lib/actions/ship";

export type PullEvent = { action: string; installationId: string; repo: string; number: number; merged: boolean; body: string };
export type PullOutcome = { shipped: string[]; linked: string[]; closed: number; reopened: number };

/** The short id in a pull request description's "PMA: <short id>" line, or null. */
export function pmaMarker(body: string): string | null {
  const m = /(?:^|\n)[ \t>*_-]*PMA:\s*([A-Za-z0-9][A-Za-z0-9-]{0,39})[ \t*_]*(?:\r?\n|$)/.exec(body ?? "");
  return m ? m[1] : null;
}

export async function onPullRequest(e: PullEvent, db: SupabaseClient = serviceDb()): Promise<PullOutcome> {
  const out: PullOutcome = { shipped: [], linked: [], closed: 0, reopened: 0 };
  const { data: conns } = await db.from("connections").select("org_id").eq("kind", "github").eq("external_id", e.installationId).in("status", ["ok", "broken"]);
  const orgs = [...new Set((conns ?? []).map((c) => c.org_id as string))];
  if (!orgs.length) return out;
  const { data: apps } = await db.from("projects").select("id, repo_full_name, kind").in("org_id", orgs);
  const mine = (apps ?? []).filter((a) => a.kind !== "demo" && typeof a.repo_full_name === "string" && a.repo_full_name.toLowerCase() === e.repo.toLowerCase());
  if (!mine.length) return out;
  const appIds = mine.map((a) => a.id as string);

  const { data: rows } = await db.from("pull_request_links").select("id, issue_id, state, repo, number, issues!inner(project_id, status)")
    .eq("number", e.number).in("issues.project_id", appIds);
  const links = (rows ?? []).filter((l) => String(l.repo).toLowerCase() === e.repo.toLowerCase()) as unknown as { id: string; issue_id: string; state: string; issues: { status: string } }[];

  if (e.action === "closed" && e.merged) {
    for (const l of links) {
      if (l.issues.status === "ready_to_build") {
        const r = await markShipped(l.issue_id, null, db, { via: "github", prNumber: e.number });
        if (r.ok) out.shipped.push(l.issue_id);
      } else if (l.state !== "merged") {
        await db.from("pull_request_links").update({ state: "merged" }).eq("id", l.id);
      }
    }
    return out;
  }
  if (e.action === "closed") {
    const ids = links.filter((l) => l.state === "open").map((l) => l.id);
    if (ids.length) await db.from("pull_request_links").update({ state: "closed" }).in("id", ids);
    out.closed = ids.length;
    return out;
  }
  if (e.action === "reopened") {
    const ids = links.filter((l) => l.state === "closed").map((l) => l.id);
    if (ids.length) await db.from("pull_request_links").update({ state: "open" }).in("id", ids);
    out.reopened = ids.length;
  }
  if (e.action === "opened" || e.action === "edited" || e.action === "reopened") {
    const short = pmaMarker(e.body);
    if (!short) return out;
    const { data: issues } = await db.from("issues").select("id, project_id, status").ilike("short_id", short).in("project_id", appIds).eq("status", "ready_to_build");
    for (const issue of issues ?? []) {
      if (links.some((l) => l.issue_id === issue.id)) continue;
      const app = mine.find((a) => a.id === issue.project_id)!;
      const url = `https://github.com/${app.repo_full_name}/pull/${e.number}`;
      const { error } = await db.from("pull_request_links").insert({ issue_id: issue.id, url, repo: app.repo_full_name, number: e.number, state: "open", linked_by: null });
      if (error) { if (error.code !== "23505") console.error("[github] marker link failed", issue.id, error.message); continue; }
      await db.from("activity").insert({ issue_id: issue.id, user_id: null, kind: "pr_linked", payload: { via: "marker", pr_url: url, pr_number: e.number } });
      out.linked.push(issue.id as string);
    }
  }
  return out;
}
