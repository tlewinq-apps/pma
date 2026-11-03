// Deepgram pre-recorded transcription with speaker diarization. Deepgram fetches the audio itself from a short-lived
// Storage link, so recordings never pass through a Vercel function body (which caps near 4.5 MB).
import type { Utterance } from "./format";

const LISTEN_URL = "https://api.deepgram.com/v1/listen?model=nova-3&diarize=true&utterances=true&smart_format=true&punctuate=true";

type DeepgramJson = { metadata?: { duration?: number }; results?: { utterances?: { start: number; end: number; transcript: string; speaker?: number }[] } };

export function parseDeepgram(json: unknown): { utterances: Utterance[]; durationSec: number | null } {
  const j = json as DeepgramJson;
  const raw = j.results?.utterances;
  if (!raw?.length) throw new Error("No speech found in the recording");
  const utterances = raw.filter((u) => u.transcript.trim()).map((u) => ({ speaker: u.speaker ?? 0, start: u.start, end: u.end, text: u.transcript.trim() }));
  if (!utterances.length) throw new Error("No speech found in the recording");
  return { utterances, durationSec: j.metadata?.duration ?? null };
}

export async function deepgramListen(audioUrl: string, apiKey: string) {
  const r = await fetch(LISTEN_URL, {
    method: "POST",
    headers: { authorization: `Token ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ url: audioUrl }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!r.ok) throw new Error(`Deepgram ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return parseDeepgram(await r.json());
}
