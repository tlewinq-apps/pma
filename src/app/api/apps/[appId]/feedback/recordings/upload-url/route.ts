import { NextResponse } from "next/server";
import { appById } from "@/lib/db/app";
import { notFoundResponse } from "@/lib/api/guards";
import { serviceDb } from "@/lib/db/server";
import { recordingPath, validateRecordingUpload } from "@/lib/ingest/recording";

/** Step 1 of a recording upload: a signed URL the browser PUTs the file to, so audio never passes through this server. */
export async function POST(req: Request, { params }: { params: Promise<{ appId: string }> }) {
  const ctx = await appById((await params).appId);
  if (!ctx) return notFoundResponse();
  const { project } = ctx;
  const body = (await req.json().catch(() => null)) as { filename?: string; size?: number; sha256?: string } | null;
  const check = validateRecordingUpload(body);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
  const path = recordingPath(project.id, body!.sha256!, check.ext);
  const { data, error } = await serviceDb().storage.from("uploads").createSignedUploadUrl(path, { upsert: true });
  if (error || !data) return NextResponse.json({ error: `Could not start the upload: ${error?.message ?? "no URL"}` }, { status: 500 });
  return NextResponse.json({ path, url: data.signedUrl });
}
