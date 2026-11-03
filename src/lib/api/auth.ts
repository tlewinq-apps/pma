import { serviceDb } from "@/lib/db/server";
import { bearerToken } from "./v1";

/** The app an API key belongs to: what /api/v1 and the MCP server (/api/mcp) scope every read and write to. */
export type ApiApp = { id: string; slug: string; name: string; kind: string; repo_full_name: string | null; watched_branch: string | null; org_slug: string };

/**
 * Resolve the project for `Authorization: Bearer <project api_key>`.
 * Empty/malformed keys are rejected before any query. The key is matched by exact equality in the database,
 * so there is no application-side string comparison that could leak timing.
 */
export async function projectForApiKey(req: Request): Promise<ApiApp | null> {
  const key = bearerToken(req.headers.get("authorization"));
  if (!key) return null;
  const { data } = await serviceDb().from("projects")
    .select("id, slug, name, kind, repo_full_name, watched_branch, organizations(slug)").eq("api_key", key).maybeSingle();
  if (!data) return null;
  const p = data as Omit<ApiApp, "org_slug"> & { organizations?: { slug?: string } | null };
  return { id: p.id, slug: p.slug, name: p.name, kind: p.kind, repo_full_name: p.repo_full_name ?? null, watched_branch: p.watched_branch ?? null, org_slug: p.organizations?.slug ?? "" };
}
