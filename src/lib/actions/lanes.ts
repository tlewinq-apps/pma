import type { Lane } from "@/lib/types";
import { solveAndDraft } from "./solveAndDraft";
import { notifyQuickWin } from "@/lib/slack/notify";
import { serviceDb } from "@/lib/db/server";
import { awaitingDiagnosis, parseDiagnosis } from "@/lib/diagnosis/model";
/**
 * Quick wins and Explore issues get proposals and a draft on their own, once their first step is done.
 * AUTO_DRAFT=off leaves that to a person; the quick-win alert still goes out. Nothing skips ahead: every issue waits
 * for someone to run its first step (diagnostics, scoping, finding where it fits, mapping the steps), and the
 * proposals are written from what that finds.
 */
export async function onLaneEntered(issueId: string, lane: Lane): Promise<void> {
  const { data: i } = await serviceDb().from("issues").select("type, diagnosis").eq("id", issueId).maybeSingle();
  const auto = process.env.AUTO_DRAFT !== "off" && !(i && awaitingDiagnosis(i.type, parseDiagnosis(i.diagnosis)));
  if (lane === "quick_win") { await notifyQuickWin(issueId); if (auto) await solveAndDraft(issueId, 1); }
  if (lane === "explore" && auto) await solveAndDraft(issueId, 3);
}
