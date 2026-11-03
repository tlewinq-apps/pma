import { z } from "zod";
import type { StructuredCaller } from "@/lib/llm/client";
import { promptsFor } from "@/lib/llm/prompts";
import { speakerRolesFor, type ProductProfile } from "@/lib/product/profile";
import { fallbackSpeakers, mergeUtterances, type Utterance } from "./format";
import type { NamedSpeaker } from "./types";

/** An app's roles are its one user ("member" in the demo), staff or other. */
const speakersOutFor = (p: ProductProfile) => z.object({
  speakers: z.array(z.object({ label: z.string(), name: z.string(), role: z.enum(speakerRolesFor(p) as [string, ...string[]]) })),
});

/**
 * Who each "Speaker N" is, from the participant list the person typed and from introductions in the conversation.
 * Anyone the model can't place, or every speaker if the call fails, keeps a numbered name. `profile` is the app the
 * conversation is about.
 */
export async function nameSpeakers(llm: StructuredCaller, us: Utterance[], participants: string, profile: ProductProfile): Promise<NamedSpeaker[]> {
  const fallback = fallbackSpeakers(us);
  try {
    const sample = mergeUtterances(us).slice(0, 40).map((t) => `Speaker ${t.speaker}: ${t.text}`).join("\n");
    const out = await llm({
      system: promptsFor(profile).speakers,
      user: [`Participants given: ${participants.trim() || "none"}`, `Speaker labels: ${fallback.map((s) => s.label).join(", ")}`, "", "Conversation (start):", sample].join("\n"),
      schema: speakersOutFor(profile),
      effort: "low",
      maxTokens: 2000,
    });
    const named = new Map(out.speakers.filter((s) => s.name.trim()).map((s) => [s.label, { ...s, name: s.name.trim() }]));
    return fallback.map((f) => named.get(f.label) ?? f);
  } catch (e) {
    console.error("[transcribe] naming speakers failed", e);
    return fallback;
  }
}
