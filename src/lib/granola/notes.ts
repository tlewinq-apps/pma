// Granola meeting notes as feedback. A company connects its Granola workspace once (company-level); each new note
// arrives through the webhook within a minute of note.generated (or the daily catch-up, since Granola does not
// replay after four days) and becomes a 'granola' source in the company's default app, transcript and attendees
// included. One note is one source (keyed granola:<note id>), however many times it is announced.
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";
import { enqueueSource } from "@/lib/ingest/enqueue";
import { audit, connectionById, disconnect, findConnection, last4, markConnection, putSecret, readSecretJson, saveConnection, type Connection } from "@/lib/connections/store";
import { GranolaError, granolaApi, granolaKeyError, type GranolaApi, type GranolaNote, type GranolaWebhook } from "./client";

export type GranolaSecret = { api_key: string; webhook_secret: string | null; webhook_id: string | null };
export type GranolaConfig = { default_project_id: string | null; webhook_id: string | null; last_sync_at: string | null };

export const parseGranolaConfig = (v: unknown): GranolaConfig => {
  const c = (v ?? {}) as Partial<GranolaConfig>;
  return { default_project_id: typeof c.default_project_id === "string" ? c.default_project_id : null, webhook_id: c.webhook_id ?? null, last_sync_at: c.last_sync_at ?? null };
};

const MAX_TEXT = 200_000;

/** Who said a transcript line: the named speaker, the note's owner for their microphone, else "Speaker <label>". */
function speakerOf(e: NonNullable<GranolaNote["transcript"]>[number], owner: string | null): string {
  const s = e.speaker ?? {};
  if (s.name) return s.name;
  if (s.source === "microphone" && owner) return owner;
  return s.diarization_label ? `Speaker ${s.diarization_label}` : "Someone";
}

/** The source row for a note: the transcript as "Name: text" lines (or the summary when there's none), with who was there. */
export function noteToSource(note: GranolaNote): { kind: "granola"; raw_text: string; author: string | null; channel: string; occurred_at: string | null; metadata: Record<string, unknown>; hashKey: string } {
  const owner = note.owner?.name ?? note.owner?.email ?? null;
  const lines = (note.transcript ?? []).filter((e) => e.text?.trim()).map((e) => `${speakerOf(e, owner)}: ${e.text!.trim()}`);
  const text = lines.length ? lines.join("\n") : (note.summary_markdown ?? note.summary_text ?? "").trim();
  const title = note.title?.trim() || note.calendar_event?.event_title?.trim() || "Meeting";
  const attendees = (note.attendees ?? []).map((a) => ({ name: a.name ?? null, email: a.email ?? null })).filter((a) => a.name || a.email);
  return {
    kind: "granola", raw_text: text.slice(0, MAX_TEXT), author: owner, channel: `Granola: ${title}`.slice(0, 200),
    occurred_at: note.calendar_event?.scheduled_start_time ?? note.created_at ?? null,
    metadata: { granola: { note_id: note.id, title, web_url: note.web_url ?? null, owner: note.owner ?? null, attendees, transcript: lines.length > 0 } },
    hashKey: `granola:${note.id}`,
  };
}

export type GranolaCtx = { conn: Connection; config: GranolaConfig; secret: GranolaSecret; api: GranolaApi };

export async function granolaFor(connectionId: string, db: SupabaseClient = serviceDb(), f?: typeof fetch): Promise<GranolaCtx | null> {
  const conn = await connectionById(connectionId, db);
  if (!conn || conn.kind !== "granola" || conn.status !== "ok") return null;
  const secret = await readSecretJson<GranolaSecret & Record<string, unknown>>(conn.id, db);
  if (!secret?.api_key) return null;
  return { conn, config: parseGranolaConfig(conn.config), secret, api: granolaApi(secret.api_key, f) };
}

/** The app new notes go to: the company's default app, if it is still the company's; else its first app. */
export async function targetApp(g: GranolaCtx, db: SupabaseClient = serviceDb()): Promise<string | null> {
  const { data: apps } = await db.from("projects").select("id, created_at").eq("org_id", g.conn.org_id).order("created_at");
  const ids = (apps ?? []).map((a) => a.id as string);
  return g.config.default_project_id && ids.includes(g.config.default_project_id) ? g.config.default_project_id : ids[0] ?? null;
}

/** Reads one note and queues it as feedback. Returns the source id and whether it is new. */
export async function ingestNote(g: GranolaCtx, noteId: string, db: SupabaseClient = serviceDb()): Promise<{ sourceId: string; fresh: boolean } | null> {
  const projectId = await targetApp(g, db);
  if (!projectId) return null;
  const note = await g.api.getNote(noteId);
  const src = noteToSource(note);
  if (!src.raw_text) return null; // a note with no transcript or summary yet: the edit or the catch-up brings it later
  const { hashKey, ...input } = src;
  const r = await enqueueSource(projectId, { ...input, hashKey });
  return { sourceId: r.id, fresh: !r.duplicate };
}

/** Granola stopped accepting the key: Needs attention, so Settings and Start here say so. */
async function brokenKey(g: GranolaCtx, e: unknown, db: SupabaseClient) {
  if (e instanceof GranolaError && (e.status === 401 || e.status === 403)) {
    await markConnection(g.conn.id, "broken", "Granola stopped accepting this key. Paste a new one.", db);
    await audit({ orgId: g.conn.org_id, action: "connection.broken", target: "granola", detail: { status: e.status } }, db);
  }
}

/**
 * The catch-up: every note created since the last run (or the last four days the first time), queued as feedback.
 * New sources wait for the processing cron. Never throws.
 */
export async function granolaCatchUp(connectionId: string, db: SupabaseClient = serviceDb(), now = Date.now()): Promise<{ queued: number; seen: number; error?: string }> {
  const g = await granolaFor(connectionId, db).catch(() => null);
  if (!g) return { queued: 0, seen: 0, error: "Granola isn't connected" };
  const since = g.config.last_sync_at ?? new Date(now - 4 * 86_400_000).toISOString();
  const started = new Date(now).toISOString();
  let queued = 0, seen = 0, cursor: string | null = null;
  try {
    do {
      const page = await g.api.listNotes({ created_after: since, cursor, page_size: 30 });
      for (const n of page.notes) {
        seen++;
        try {
          const r = await ingestNote(g, n.id, db);
          if (r?.fresh) queued++;
        } catch (e) {
          if (e instanceof GranolaError && (e.status === 401 || e.status === 403)) throw e;
          console.warn("[granola] skipped a note", n.id, (e as Error).message); // gone or unshared since: the rest still come in
        }
      }
      cursor = page.hasMore ? page.cursor : null;
    } while (cursor && seen < 300);
    await saveConnection("granola", { orgId: g.conn.org_id, projectId: null }, { status: "ok", config: { ...g.config, last_sync_at: started }, display: { ...g.conn.display, last_sync: started } }, db);
    return { queued, seen };
  } catch (e) {
    await brokenKey(g, e, db);
    console.error("[granola] catch-up failed", connectionId, (e as Error).message);
    return { queued, seen, error: (e as Error).message };
  }
}

/** The daily run over every connected Granola workspace. */
export async function granolaCatchUpAll(db: SupabaseClient = serviceDb()): Promise<Record<string, { queued: number; seen: number; error?: string }>> {
  const { data } = await db.from("connections").select("id").eq("kind", "granola").eq("status", "ok");
  const out: Record<string, { queued: number; seen: number; error?: string }> = {};
  for (const { id } of data ?? []) out[id as string] = await granolaCatchUp(id as string, db);
  return out;
}

export const GRANOLA_EVENTS = ["note.generated", "note.access_granted"];

/**
 * Connects the company's Granola: checks the key (GET /v1/notes, one note), registers the webhook for this
 * deployment (a workspace key first, then a personal key's scopes) and keeps the key and the webhook's signing secret
 * in Vault. Without a public https APP_URL there is no webhook, and notes arrive with the daily catch-up instead.
 */
export async function connectGranola(
  s: { orgId: string; projectId: string; userId: string }, key: string, opts: { appUrl: string; f?: typeof fetch; db?: SupabaseClient },
): Promise<{ ok: true; webhook: boolean } | { ok: false; error: string }> {
  const db = opts.db ?? serviceDb();
  if (!/^grn_[A-Za-z0-9_-]{16,}$/.test(key)) return { ok: false, error: "Paste a Granola API key. It starts with grn_ and is made in Granola under Settings, API." };
  const api = granolaApi(key, opts.f);
  try {
    await api.listNotes({ page_size: 1 });
  } catch (e) {
    return { ok: false, error: granolaKeyError(e) };
  }
  // Connecting again: the old webhook goes, so Granola never calls with a secret PMA no longer has.
  const before = await findConnection("granola", { orgId: s.orgId, projectId: null }, db);
  const old = before ? await readSecretJson<GranolaSecret & Record<string, unknown>>(before.id, db).catch(() => null) : null;
  if (old?.webhook_id && old.api_key) await granolaApi(old.api_key, opts.f).deleteWebhook(old.webhook_id).catch(() => undefined);
  const prev = parseGranolaConfig(before?.config);
  const config: GranolaConfig = { default_project_id: prev.default_project_id ?? s.projectId, webhook_id: null, last_sync_at: prev.last_sync_at };
  const conn = await saveConnection("granola", { orgId: s.orgId, projectId: null }, { status: "pending", display: { last4: last4(key) }, config, userId: s.userId }, db);

  let webhook: GranolaWebhook | null = null;
  const base = opts.appUrl.replace(/\/+$/, "");
  if (base.startsWith("https://")) {
    const url = `${base}/api/granola/webhook/${conn.id}`;
    try {
      webhook = await api.createWebhook({ url, scopes: ["workspace"], events: GRANOLA_EVENTS });
    } catch (e) {
      // A personal key can't register workspace-wide; it can register for the notes it can see.
      if (!(e instanceof GranolaError) || e.status >= 500) return { ok: false, error: granolaKeyError(e) };
      try { webhook = await api.createWebhook({ url, scopes: ["personal", "public"], events: GRANOLA_EVENTS }); } catch (e2) { return { ok: false, error: granolaKeyError(e2) }; }
    }
  }
  await putSecret(conn.id, { api_key: key, webhook_secret: webhook?.signing_secret ?? null, webhook_id: webhook?.id ?? null }, db);
  await saveConnection("granola", { orgId: s.orgId, projectId: null }, {
    status: "ok", verified: true, externalId: webhook?.id ?? null, display: { last4: last4(key), webhook: !!webhook },
    config: { ...config, webhook_id: webhook?.id ?? null },
  }, db);
  await audit({ orgId: s.orgId, projectId: s.projectId, actorId: s.userId, action: "connection.connected", target: "granola", detail: { last4: last4(key), webhook: !!webhook } }, db);
  return { ok: true, webhook: !!webhook };
}

/** Disconnect: the webhook is removed in Granola (best effort) and the key forgotten. */
export async function disconnectGranola(s: { orgId: string; projectId: string; userId: string }, opts: { f?: typeof fetch; db?: SupabaseClient } = {}): Promise<void> {
  const db = opts.db ?? serviceDb();
  const conn = await findConnection("granola", { orgId: s.orgId, projectId: null }, db);
  if (!conn) return;
  const secret = await readSecretJson<GranolaSecret & Record<string, unknown>>(conn.id, db).catch(() => null);
  if (secret?.webhook_id && secret.api_key) await granolaApi(secret.api_key, opts.f).deleteWebhook(secret.webhook_id).catch(() => undefined);
  await disconnect(conn.id, db);
  await audit({ orgId: s.orgId, projectId: s.projectId, actorId: s.userId, action: "connection.disconnected", target: "granola" }, db);
}

/** Which of the company's apps new notes go to. */
export async function setGranolaApp(s: { orgId: string; userId: string }, projectId: string, db: SupabaseClient = serviceDb()): Promise<boolean> {
  const conn = await findConnection("granola", { orgId: s.orgId, projectId: null }, db);
  const { data: app } = await db.from("projects").select("id").eq("id", projectId).eq("org_id", s.orgId).maybeSingle();
  if (!conn || !app) return false;
  await saveConnection("granola", { orgId: s.orgId, projectId: null }, { status: conn.status, config: { ...parseGranolaConfig(conn.config), default_project_id: projectId } }, db);
  return true;
}
