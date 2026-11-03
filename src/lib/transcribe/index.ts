import type { StructuredCaller } from "@/lib/llm/client";
import type { SourceRow } from "@/lib/pipeline/repo";
import { ownedPath } from "@/lib/ingest/files";
import { formatTranscript, type Utterance } from "./format";
import { nameSpeakers } from "./speakers";
import type { Transcript } from "./types";
import type { ProductProfile } from "@/lib/product/profile";

export type TranscribeDeps = {
  llm: StructuredCaller;
  /** Deepgram (or another provider) given a fetchable audio URL. Unset when no key is configured. */
  listen?: (audioUrl: string) => Promise<{ utterances: Utterance[]; durationSec: number | null }>;
  /** A short-lived download link for a Storage path. */
  signedUrl: (path: string) => Promise<string>;
  /** Bundled sample recordings, keyed by file SHA-256, so the demo works with no transcription key. */
  samples: Record<string, Transcript>;
};

/** `profile`: the app the recording is about, so speakers are named in its words (a shopper, not a member). */
export async function transcribeSource(src: SourceRow, d: TranscribeDeps, profile: ProductProfile): Promise<Transcript> {
  const meta = (src.metadata ?? {}) as { sha256?: string; participants?: string };
  const sample = meta.sha256 ? d.samples[meta.sha256] : undefined;
  if (sample) return sample;
  if (!d.listen) throw new Error("Recordings need DEEPGRAM_API_KEY to be transcribed (the bundled sample recordings work without it)");
  // Members can write file_path; only a recording in this app's own upload folder is signed for the transcriber.
  const path = ownedPath(src.project_id, src.file_path);
  if (!path) throw new Error("Recording file is missing");
  const { utterances, durationSec } = await d.listen(await d.signedUrl(path));
  const speakers = await nameSpeakers(d.llm, utterances, meta.participants ?? "", profile);
  return { text: formatTranscript(utterances, speakers), speakers, durationSec };
}
