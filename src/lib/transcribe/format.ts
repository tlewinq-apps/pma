import type { NamedSpeaker } from "./types";

/** One diarized turn from the transcriber: who (a number), when, and what was said. */
export type Utterance = { speaker: number; start: number; end: number; text: string };

export function mergeUtterances(us: Utterance[]): Utterance[] {
  const out: Utterance[] = [];
  for (const u of us) {
    const last = out.at(-1);
    if (last && last.speaker === u.speaker) out[out.length - 1] = { ...last, text: `${last.text} ${u.text}`, end: u.end };
    else out.push({ ...u });
  }
  return out;
}

const label = (n: number) => `Speaker ${n}`;
/** Transcriber labels start at 0; people count from 1. */
const unnamed = (n: number): NamedSpeaker => ({ label: label(n), name: `Speaker ${n + 1}`, role: "other" });

/** Numbered names for everyone, in the order they first speak, for when nobody could be named. */
export function fallbackSpeakers(us: Utterance[]): NamedSpeaker[] {
  return [...new Set(us.map((u) => u.speaker))].map(unnamed);
}

/**
 * `Participants: …` then one `Name: text` line per turn. Roles live only in the header, so the names the extract
 * step copies into `speakers` stay plain and match the same person in other sources.
 */
export function formatTranscript(us: Utterance[], speakers: NamedSpeaker[]): string {
  const known = new Map(speakers.map((s) => [s.label, s]));
  const who = (id: number) => known.get(label(id)) ?? unnamed(id);
  const turns = mergeUtterances(us);
  const people = [...new Map(turns.map((t) => [t.speaker, who(t.speaker)])).values()];
  const header = `Participants: ${people.map((p) => (p.role === "other" ? p.name : `${p.name} (${p.role})`)).join(", ")}`;
  return [header, "", ...turns.map((t) => `${who(t.speaker).name}: ${t.text}`)].join("\n");
}
