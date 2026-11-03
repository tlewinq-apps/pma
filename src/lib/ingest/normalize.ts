import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { simpleParser } from "mailparser";
import { stripCaptions } from "@/lib/text";
import { callStructured } from "@/lib/llm/client";
import { z } from "zod";

export async function normalizeFile(name: string, bytes: Buffer): Promise<string> {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "txt": case "md": case "csv": return bytes.toString("utf8");
    case "vtt": case "srt": return stripCaptions(bytes.toString("utf8"));
    case "docx": return (await mammoth.extractRawText({ buffer: bytes })).value;
    case "pdf": { const pdf = await getDocumentProxy(new Uint8Array(bytes)); return (await extractText(pdf, { mergePages: true })).text as string; }
    case "eml": { const m = await simpleParser(bytes); return `From: ${m.from?.text ?? ""}\nSubject: ${m.subject ?? ""}\n\n${m.text ?? ""}`; }
    default: throw new Error(`Unsupported file type .${ext}`);
  }
}

/** Screenshots (png/jpg/webp) are transcribed with vision; kept separate so normalizeFile stays pure. */
export async function transcribeImage(name: string, bytes: Buffer, mediaType: "image/png" | "image/jpeg" | "image/webp"): Promise<string> {
  const out = await callStructured({
    system: "Transcribe every message visible in this screenshot of a conversation, verbatim, one per line as 'Name: text'. Include nothing else.",
    user: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: bytes.toString("base64") } },
      { type: "text", text: `Screenshot: ${name}` },
    ],
    schema: z.object({ transcript: z.string() }),
    effort: "low",
  });
  return out.transcript;
}
