// Granola calls this when a note is generated (or shared) in a connected workspace. Each company's endpoint has its
// own URL and signing secret: the Standard Webhooks signature is checked against that secret, over the raw body,
// before anything is read. Then PMA answers 200 at once (Granola allows 15 s) and, after the response, fetches the
// note with its transcript, queues it as feedback in the company's default app and runs it through the pipeline.
import { NextResponse, after } from "next/server";
import { granolaFor, ingestNote } from "@/lib/granola/notes";
import { verifyStandardWebhook } from "@/lib/granola/webhook";
import { runSource } from "@/lib/pipeline/deps";

export const maxDuration = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTE_EVENTS = new Set(["note.generated", "note.access_granted"]);

export async function POST(req: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;
  const raw = await req.text();
  // An unknown or disconnected endpoint is a permanent 404: Granola stops retrying it.
  const g = UUID.test(connectionId) ? await granolaFor(connectionId).catch(() => null) : null;
  if (!g?.secret.webhook_secret) return NextResponse.json({ error: "not found" }, { status: 404 });
  const ok = verifyStandardWebhook(g.secret.webhook_secret, {
    id: req.headers.get("webhook-id"), timestamp: req.headers.get("webhook-timestamp"), signature: req.headers.get("webhook-signature"),
  }, raw);
  if (!ok) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  let body: { event_type?: unknown; note_id?: unknown };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const noteId = typeof body.note_id === "string" && /^not_[A-Za-z0-9]{1,40}$/.test(body.note_id) ? body.note_id : null;
  if (!noteId || typeof body.event_type !== "string" || !NOTE_EVENTS.has(body.event_type)) return new NextResponse(null, { status: 200 });
  after(async () => {
    try {
      const r = await ingestNote(g, noteId);
      if (r?.fresh) await runSource(r.sourceId);
    } catch (e) {
      // The daily catch-up picks up anything missed here.
      console.error("[granola] note failed", noteId, (e as Error).message);
    }
  });
  return new NextResponse(null, { status: 200 });
}
