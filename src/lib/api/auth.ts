import { serviceDb } from "@/lib/db/server";
import { bearerToken } from "./v1";

/**
 * Resolve the project for `Authorization: Bearer <project api_key>`.
 * Empty/malformed keys are rejected before any query. The key is matched by exact equality in the database,
 * so there is no application-side string comparison that could leak timing.
 */
export async function projectForApiKey(req: Request): Promise<{ id: string } | null> {
  const key = bearerToken(req.headers.get("authorization"));
  if (!key) return null;
  const { data } = await serviceDb().from("projects").select("id").eq("api_key", key).maybeSingle();
  return data ?? null;
}
