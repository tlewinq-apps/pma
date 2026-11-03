// Ownership from Slack. Whoever runs an issue's first step or mocks up a proposal owns it if nobody does
// (assignIfUnowned). "Take it on" is the older button that did only this; cards posted before it was removed
// still carry it, so it keeps working.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionResult } from "./approve";
import { awaitingDiagnosis, parseDiagnosis } from "@/lib/diagnosis/model";

export type TakeOnResult = ActionResult & { ownerId?: string; propose?: 1 | 3 | null };

/**
 * Makes `userId` the owner when nobody owns the issue; someone else's ownership stays. Returns the owner after.
 * `auto` marks an assignment that came with another action, so the Slack thread doesn't announce it separately.
 */
export async function assignIfUnowned(db: SupabaseClient, issueId: string, userId: string, via: "web" | "slack", auto = true): Promise<string | null> {
  const { data: claimed } = await db.from("issues").update({ owner_id: userId, updated_at: new Date().toISOString() }).eq("id", issueId).is("owner_id", null).select("id");
  if (claimed?.length) {
    await db.from("activity").insert({ issue_id: issueId, user_id: userId, kind: "assigned", payload: { to: "me", via, ...(auto ? { auto: true } : {}) } });
    return userId;
  }
  return (await db.from("issues").select("owner_id").eq("id", issueId).maybeSingle()).data?.owner_id ?? null;
}

/** Assigns `userId` when nobody owns the issue. Says how many proposals to write, if any: none while the issue waits on its first step. */
export async function takeOn(db: SupabaseClient, issueId: string, userId: string): Promise<TakeOnResult> {
  const { data: i } = await db.from("issues").select("id, lane, status, owner_id, type, diagnosis").eq("id", issueId).maybeSingle();
  if (!i) return { ok: false, status: 404, error: "not found" };
  const ownerId = (i.owner_id as string | null) ?? await assignIfUnowned(db, issueId, userId, "slack", false);
  const { count } = await db.from("solutions").select("id", { count: "exact", head: true }).eq("issue_id", issueId);
  const propose = !count && i.status !== "drafting" && !awaitingDiagnosis(i.type, parseDiagnosis(i.diagnosis)) ? (i.lane === "quick_win" ? 1 : 3) : null;
  return { ok: true, ownerId: ownerId ?? userId, propose };
}
