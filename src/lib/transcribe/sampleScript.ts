import { formatTranscript } from "./format";
import type { NamedSpeaker, Transcript } from "./types";

/** A sample recording's script: each line is spoken by a macOS voice (scripts/demo/make-sample-audio.ts). */
export type SampleScript = { lines: { voice: string; name: string; role: NamedSpeaker["role"]; text: string }[] };

/** The transcript PMA would produce for the sample, with speakers labelled in order of first appearance. */
export function scriptToTranscript(script: SampleScript, durationSec: number | null): Transcript {
  const order: string[] = [];
  for (const l of script.lines) if (!order.includes(l.name)) order.push(l.name);
  const speakers: NamedSpeaker[] = order.map((name, k) => ({ label: `Speaker ${k}`, name, role: script.lines.find((l) => l.name === name)!.role }));
  const utterances = script.lines.map((l, i) => ({ speaker: order.indexOf(l.name), start: i, end: i + 1, text: l.text }));
  return { text: formatTranscript(utterances, speakers), speakers, durationSec };
}
