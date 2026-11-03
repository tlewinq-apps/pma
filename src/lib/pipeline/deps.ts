import { callStructured } from "@/lib/llm/client";
import { embed } from "@/lib/embeddings";
import { supabasePipelineRepo } from "@/lib/db/pipelineRepo";
import { embeddingsEnabled, slackEnabled, transcriptionEnabled } from "@/lib/env";
import { serviceDb } from "@/lib/db/server";
import { transcribeSource } from "@/lib/transcribe";
import { deepgramListen } from "@/lib/transcribe/deepgram";
import { SAMPLE_TRANSCRIPTS } from "@/lib/transcribe/samples.generated";
import { processSource, type PipelineDeps } from "./run";
import { withSourceClaude } from "@/lib/llm/scope";
import { onLaneEntered } from "@/lib/actions/lanes";

/** Cards for new and grown issues go to Slack right after clustering (see slackOnFiled); loaded lazily. */
const onFiled = async (sourceId: string, issueIds: string[]) => (await import("@/lib/slack/inbox")).slackOnFiled(sourceId, issueIds);
/** Those cards again once scoring is saved, so they show the final people count and stage. */
const onProcessed = async (sourceId: string, issueIds: string[]) => (await import("@/lib/slack/inbox")).slackOnProcessed(sourceId, issueIds);
/** CLARITY_FOLLOWUP_MAX: at or below this clarity rating (1-5, "Loose" or vaguer) PMA drafts follow-up questions. */
const CLARITY_FOLLOWUP_MAX = 2;
/** After each score: blocking-bug and sudden-jump alerts, and follow-up questions for vague issues. Loaded lazily. */
const onScored: PipelineDeps["onScored"] = async (issueId, e) => {
  await (await import("@/lib/alerts/send")).alertsAfterScore(issueId, e);
  if (e.clarity <= CLARITY_FOLLOWUP_MAX) await (await import("@/lib/actions/followups")).draftFollowupsIfNone(issueId);
};

/** Deepgram fetches the recording from a 10-minute link; the bundled samples need no key at all. */
const transcribe: PipelineDeps["transcribe"] = (src, profile) => transcribeSource(src, {
  llm: callStructured,
  listen: transcriptionEnabled() ? (url) => deepgramListen(url, process.env.DEEPGRAM_API_KEY!) : undefined,
  signedUrl: async (path) => {
    const { data, error } = await serviceDb().storage.from("uploads").createSignedUrl(path, 600);
    if (error || !data) throw new Error(`Could not open the recording: ${error?.message ?? "no link"}`);
    return data.signedUrl;
  },
  samples: SAMPLE_TRANSCRIPTS,
}, profile);

export const pipelineDeps = (): PipelineDeps => ({
  repo: supabasePipelineRepo(), llm: callStructured, embed: embeddingsEnabled() ? embed : null, onLaneEntered, onFiled: slackEnabled() ? onFiled : undefined,
  onProcessed: slackEnabled() ? onProcessed : undefined, transcribe, onScored,
});

/**
 * Runs one source through the pipeline on its app's Claude key (withSourceClaude), so a company's feedback is read with
 * that company's key. Every route, the cron and the drain go through this; tests call processSource with fakes.
 */
export const runSource = (sourceId: string, overrides: Partial<PipelineDeps> = {}): Promise<void> =>
  withSourceClaude(sourceId, () => processSource({ ...pipelineDeps(), ...overrides }, sourceId));
