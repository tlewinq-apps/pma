// What PMA sends to whoever drafts a mockup (the GitHub Action, or the mock runner): the contract both sides
// share. GitHub caps client_payload at 10 top-level keys, so the whole thing nests under `draft`.
import { z } from "zod";

export const DraftPayload = z.object({
  draft_id: z.string(),
  branch: z.string(),
  mode: z.string(),
  target_frames: z.array(z.string()),
  issue_short_id: z.string(),
  title: z.string(),
  problem: z.string(),
  type: z.string(),
  solution: z.string(),
  quotes: z.array(z.string()),
  issue_url: z.string(),
  callback_url: z.string(),
  callback_token: z.string(),
  /** Signed Storage URLs the drafter PUTs PNG screenshots to (Vercel bodies cap near 4.5 MB). */
  upload_slots: z.array(z.object({ path: z.string(), url: z.string() })),
});
export type DraftPayloadT = z.infer<typeof DraftPayload>;
export const DRAFT_PAYLOAD_FIELDS = Object.keys(DraftPayload.shape);
