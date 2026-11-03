import { serviceDb } from "@/lib/db/server";
import { friendlyLlmError } from "@/lib/llm/errors";

/** Records a failed manual lane action so the drawer shows it, as a plain sentence (the raw error goes to the log).
 *  Never throws: it runs inside after(). */
export async function logLaneActionFailed(issueId: string, lane: string, e: unknown): Promise<void> {
  console.error("[lane action] failed", issueId, lane, e instanceof Error ? e.message : e);
  const error = friendlyLlmError(e);
  try {
    const { error: insErr } = await serviceDb().from("activity").insert({ issue_id: issueId, kind: "lane_action_failed", payload: { lane, error } });
    if (insErr) console.error("[lane action] logging failed", insErr.message);
  } catch (logErr) {
    console.error("[lane action] logging failed", logErr);
  }
}
