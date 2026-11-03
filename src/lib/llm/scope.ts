// Runs work on the Claude key of the app a row belongs to (withAppClaude), for entry points that start from an issue,
// a source or a draft. A row that can't be found runs as before, on the deployment's key.
import { serviceDb } from "@/lib/db/server";
import { withAppClaude } from "./client";

async function projectOf(table: "issues" | "sources", id: string): Promise<string | null> {
  const { data } = await serviceDb().from(table).select("project_id").eq("id", id).maybeSingle();
  return (data?.project_id as string | undefined) ?? null;
}

export async function withIssueClaude<T>(issueId: string, fn: () => Promise<T>): Promise<T> {
  const projectId = await projectOf("issues", issueId).catch(() => null);
  return projectId ? withAppClaude(projectId, fn) : fn();
}

export async function withSourceClaude<T>(sourceId: string, fn: () => Promise<T>): Promise<T> {
  const projectId = await projectOf("sources", sourceId).catch(() => null);
  return projectId ? withAppClaude(projectId, fn) : fn();
}

export async function withDraftClaude<T>(draftId: string, fn: () => Promise<T>): Promise<T> {
  const { data } = await serviceDb().from("drafts").select("issue_id").eq("id", draftId).maybeSingle().then((r) => r, () => ({ data: null }));
  return data?.issue_id ? withIssueClaude(data.issue_id as string, fn) : fn();
}
