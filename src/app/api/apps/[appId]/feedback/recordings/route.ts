import { NextResponse, after } from "next/server";
import { appById } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { serviceDb } from "@/lib/db/server";
import { enqueueSource } from "@/lib/ingest/enqueue";
import { parseRecordingBody, sha256Hex } from "@/lib/ingest/recording";
import { runSource } from "@/lib/pipeline/deps";

export const maxDuration = 300;

/** Step 2: the file is in Storage, so queue it as an `audio` source. The pipeline transcribes it, then splits it into feedback. */
export async function POST(req: Request, { params }: { params: Promise<{ appId: string }> }) {
  const ctx = await appById((await params).appId);
  if (!ctx) return notFoundResponse();
  const { project } = ctx;
  const parsed = parseRecordingBody(await req.json().catch(() => null), project.id);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const r = parsed.value;
  // The upload URL overwrites, and the source is deduped (and a bundled sample transcript found) by this hash, so check
  // the bytes that arrived are the file the browser hashed. A mismatch is removed rather than left under that hash.
  const uploads = serviceDb().storage.from("uploads");
  const { data: stored } = await uploads.download(r.path);
  if (!stored) return NextResponse.json({ error: "The upload didn't arrive. Try again." }, { status: 400 });
  if ((await sha256Hex(stored)) !== r.sha256) {
    await uploads.remove([r.path]);
    return NextResponse.json({ error: "The file that arrived doesn't match the one you picked. Try again." }, { status: 400 });
  }
  const source = await enqueueSource(project.id, {
    kind: "audio", raw_text: "", file_path: r.path, author: r.who, occurred_at: r.when, channel: r.where,
    metadata: { filename: r.filename, sha256: r.sha256, participants: r.participants, consent: true },
    hashKey: `audio:${r.sha256}`,
  });
  if (!source.duplicate) after(() => runSource(source.id));
  return NextResponse.json({ sources: [source] });
}
