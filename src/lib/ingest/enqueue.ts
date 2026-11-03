import { serviceDb } from "@/lib/db/server";
import { sourceHash } from "@/lib/text";

export async function enqueueSource(projectId: string, input: { kind: string; raw_text: string; author?: string | null; channel?: string | null; occurred_at?: string | null; route?: string | null; file_path?: string | null; metadata?: Record<string, unknown>; demo?: boolean; hashKey?: string }): Promise<{ id: string; duplicate: boolean }> {
  const db = serviceDb();
  const { hashKey, ...row } = input;
  const hash = sourceHash(row.raw_text, hashKey);
  const existing = await db.from("sources").select("id").eq("project_id", projectId).eq("content_hash", hash).maybeSingle();
  if (existing.data) return { id: existing.data.id, duplicate: true };
  const { data, error } = await db.from("sources").insert({ project_id: projectId, content_hash: hash, ...row, occurred_at: row.occurred_at ?? new Date().toISOString() }).select("id").single();
  if (error) throw new Error(error.message);
  return { id: data.id, duplicate: false };
}
