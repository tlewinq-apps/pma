import { describe, it, expect, vi } from "vitest";
import { DEMO_PROFILE } from "@/lib/product/profile";
import { fallbackSpeakers, formatTranscript, mergeUtterances } from "@/lib/transcribe/format";
import { parseDeepgram } from "@/lib/transcribe/deepgram";
import { nameSpeakers } from "@/lib/transcribe/speakers";
import { transcribeSource } from "@/lib/transcribe";

const U = (speaker: number, text: string, start = 0, end = 1) => ({ speaker, text, start, end });

describe("mergeUtterances", () => {
  it("joins consecutive turns by the same speaker and keeps the time span", () => {
    expect(mergeUtterances([U(0, "Hi there.", 0, 1), U(0, "Thanks for coming.", 1, 3), U(1, "Happy to.", 3, 4), U(0, "So, pickup.", 4, 6)])).toEqual([
      U(0, "Hi there. Thanks for coming.", 0, 3), U(1, "Happy to.", 3, 4), U(0, "So, pickup.", 4, 6),
    ]);
  });
});

describe("formatTranscript", () => {
  const speakers = [{ label: "Speaker 0", name: "Ms. Rivera", role: "staff" as const }, { label: "Speaker 1", name: "Priya Shah", role: "parent" as const }];
  it("writes a participants header, then one Name: text line per turn", () => {
    expect(formatTranscript([U(0, "How is pickup going?"), U(1, "The form never confirms."), U(1, "So I call the office.")], speakers)).toBe(
      "Participants: Ms. Rivera (staff), Priya Shah (parent)\n\nMs. Rivera: How is pickup going?\nPriya Shah: The form never confirms. So I call the office.",
    );
  });
  it("keeps roles out of the names so the same person counts once across sources", () => {
    expect(formatTranscript([U(1, "Hello.")], speakers)).toContain("\nPriya Shah: Hello.");
  });
  it("falls back to numbered speakers for labels it does not know", () => {
    expect(formatTranscript([U(2, "Me too.")], speakers)).toBe("Participants: Speaker 3\n\nSpeaker 3: Me too.");
  });
});

describe("fallbackSpeakers", () => {
  it("calls label N \"Speaker N+1\" and lists speakers in order of first appearance", () => {
    expect(fallbackSpeakers([U(1, "a"), U(0, "b"), U(1, "c")])).toEqual([
      { label: "Speaker 1", name: "Speaker 2", role: "other" }, { label: "Speaker 0", name: "Speaker 1", role: "other" },
    ]);
  });
});

describe("parseDeepgram", () => {
  it("reads diarized utterances and the duration", () => {
    const json = { metadata: { duration: 92.4 }, results: { utterances: [
      { start: 0.1, end: 2.5, transcript: "Thanks for coming in.", speaker: 0, confidence: 0.99 },
      { start: 2.6, end: 5, transcript: "Of course.", speaker: 1, confidence: 0.98 },
      { start: 5, end: 5.2, transcript: "  ", speaker: 1 },
    ] } };
    expect(parseDeepgram(json)).toEqual({ utterances: [U(0, "Thanks for coming in.", 0.1, 2.5), U(1, "Of course.", 2.6, 5)], durationSec: 92.4 });
  });
  it("throws on a response without utterances", () => {
    expect(() => parseDeepgram({ results: {} })).toThrow(/no speech/i);
  });
});

describe("nameSpeakers", () => {
  const utterances = [U(0, "Hi, I'm Ms. Rivera from the front office."), U(1, "I'm Priya, Maya's mum.")];
  it("uses the model's mapping and fills in anyone it missed", async () => {
    const llm = vi.fn(async () => ({ speakers: [{ label: "Speaker 1", name: "Priya Shah", role: "parent" }, { label: "Speaker 9", name: "Ghost", role: "other" }] }));
    expect(await nameSpeakers(llm as never, utterances, "Priya Shah (parent), Ms. Rivera (staff)", DEMO_PROFILE)).toEqual([
      { label: "Speaker 0", name: "Speaker 1", role: "other" }, { label: "Speaker 1", name: "Priya Shah", role: "parent" },
    ]);
  });
  it("falls back to numbered speakers when the model fails", async () => {
    const llm = vi.fn(async () => { throw new Error("no key"); });
    expect((await nameSpeakers(llm as never, utterances, "", DEMO_PROFILE)).map((s) => s.name)).toEqual(["Speaker 1", "Speaker 2"]);
  });
});

describe("transcribeSource", () => {
  const src = { id: "s", project_id: "p", raw_text: "", author: null, channel: null, route: null, occurred_at: "", kind: "audio", file_path: "p/audio/abc.mp3", metadata: { sha256: "abc", participants: "Priya Shah (parent)" } };
  const sample = { text: "Participants: Priya Shah (parent)\n\nPriya Shah: Hi.", speakers: [{ label: "Speaker 0", name: "Priya Shah", role: "parent" as const }], durationSec: 4 };

  it("uses a bundled sample transcript without calling anything", async () => {
    const listen = vi.fn();
    expect(await transcribeSource(src, { llm: vi.fn() as never, listen, signedUrl: vi.fn(), samples: { abc: sample } }, DEMO_PROFILE)).toEqual(sample);
    expect(listen).not.toHaveBeenCalled();
  });

  it("says a key is needed for recordings that are not samples", async () => {
    await expect(transcribeSource(src, { llm: vi.fn() as never, signedUrl: vi.fn(), samples: {} }, DEMO_PROFILE)).rejects.toThrow(/DEEPGRAM_API_KEY/);
  });

  it("transcribes from a short-lived link, names speakers and formats the text", async () => {
    const signedUrl = vi.fn(async () => "https://storage/signed");
    const listen = vi.fn(async () => ({ utterances: [U(0, "The pickup form never confirms.")], durationSec: 12 }));
    const llm = vi.fn(async () => ({ speakers: [{ label: "Speaker 0", name: "Priya Shah", role: "parent" }] }));
    const t = await transcribeSource(src, { llm: llm as never, listen, signedUrl, samples: {} }, DEMO_PROFILE);
    expect(signedUrl).toHaveBeenCalledWith("p/audio/abc.mp3");
    expect(listen).toHaveBeenCalledWith("https://storage/signed");
    expect(t).toEqual({ text: "Participants: Priya Shah (parent)\n\nPriya Shah: The pickup form never confirms.", speakers: [{ label: "Speaker 0", name: "Priya Shah", role: "parent" }], durationSec: 12 });
  });

  it("never signs a recording outside the source's own app folder", async () => {
    const signedUrl = vi.fn(async () => "https://storage/signed");
    const listen = vi.fn();
    for (const file_path of ["q/audio/abc.mp3", "p/../q/audio/abc.mp3"]) {
      await expect(transcribeSource({ ...src, file_path }, { llm: vi.fn() as never, listen, signedUrl, samples: {} }, DEMO_PROFILE), file_path).rejects.toThrow("Recording file is missing");
    }
    expect(signedUrl).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
  });
});

describe("scriptToTranscript", () => {
  it("builds the same transcript the Deepgram path would, numbering voices by first appearance", async () => {
    const { scriptToTranscript } = await import("@/lib/transcribe/sampleScript");
    const t = scriptToTranscript({ lines: [
      { voice: "Samantha", name: "Ms. Rivera", role: "staff", text: "Thanks for coming." },
      { voice: "Karen", name: "Priya Shah", role: "parent", text: "Pickup never confirms." },
      { voice: "Karen", name: "Priya Shah", role: "parent", text: "So I phone the office." },
    ] }, 61.2);
    expect(t).toEqual({
      text: "Participants: Ms. Rivera (staff), Priya Shah (parent)\n\nMs. Rivera: Thanks for coming.\nPriya Shah: Pickup never confirms. So I phone the office.",
      speakers: [{ label: "Speaker 0", name: "Ms. Rivera", role: "staff" }, { label: "Speaker 1", name: "Priya Shah", role: "parent" }],
      durationSec: 61.2,
    });
  });
});
