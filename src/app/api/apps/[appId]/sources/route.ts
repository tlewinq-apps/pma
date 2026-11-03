import { NextResponse, after } from "next/server";
import { appById } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { enqueueSource } from "@/lib/ingest/enqueue";
import { normalizeFile, transcribeImage } from "@/lib/ingest/normalize";
import { unsupportedFiles, imageMediaType, uploadPath } from "@/lib/ingest/files";
import { runQueued } from "@/lib/ingest/drainRun";
import { serviceDb } from "@/lib/db/server";
import { friendlyLlmError } from "@/lib/llm/errors";
import { withAppClaude } from "@/lib/llm/client";

export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ appId: string }> }) {
  const ctx = await appById((await params).appId);
  if (!ctx) return notFoundResponse();
  const { project } = ctx;
  const form = await req.formData();
  const meta = { author: (form.get("who") as string) || null, occurred_at: (form.get("when") as string) || null, channel: (form.get("where") as string) || null };
  const results: { id: string; duplicate: boolean }[] = [];
  const files = form.getAll("files").filter((f): f is File => typeof f !== "string");
  const unsupported = unsupportedFiles(files.map((f) => f.name));
  if (unsupported.length) return NextResponse.json({ error: "Unsupported file type", unsupported }, { status: 400 });
  const text = (form.get("text") as string | null)?.trim();
  if (text) results.push(await enqueueSource(project.id, { kind: "paste", raw_text: text, ...meta }));
  const errors: { name: string; error: string }[] = [];
  for (const f of files) {
    try {
      const bytes = Buffer.from(await f.arrayBuffer());
      const image = imageMediaType(f.name, f.type);
      // A screenshot is read by Claude, on the app's own key.
      const raw = image ? await withAppClaude(project.id, () => transcribeImage(f.name, bytes, image)) : await normalizeFile(f.name, bytes);
      if (!raw.trim()) { errors.push({ name: f.name, error: "no text found" }); continue; }
      const path = uploadPath(project.id, f.name);
      const stored = await serviceDb().storage.from("uploads").upload(path, bytes, { contentType: f.type || undefined });
      // The text is what gets analysed; without the original the feedback page just offers no download.
      if (stored.error) console.error("[sources] could not store", f.name, stored.error.message);
      results.push(await enqueueSource(project.id, { kind: "file", raw_text: raw, file_path: stored.error ? null : path, ...meta, metadata: { filename: f.name } }));
    } catch (e) {
      // Screenshots are read by Claude (transcribeImage): show a plain sentence, never the API's raw JSON.
      console.error("[sources] could not read", f.name, e instanceof Error ? e.message : e);
      errors.push({ name: f.name, error: friendlyLlmError(e) });
    }
  }
  if (results.length === 0) return NextResponse.json({ error: errors.length ? "No files could be processed" : "Nothing to add", errors }, { status: 400 });
  const fresh = results.filter((r) => !r.duplicate).map((r) => r.id);
  if (fresh.length) after(() => runQueued(fresh, new URL(req.url).origin));
  return NextResponse.json({ sources: results, errors });
}
