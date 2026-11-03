// Granola's public API (https://public-api.granola.ai, Business plan), with the company's grn_ key: list and read
// notes (with their transcript), and register or remove the webhook endpoint that tells PMA about new notes.

export const granolaApiUrl = () => (process.env.GRANOLA_API_URL ?? "https://public-api.granola.ai").replace(/\/+$/, "");

export class GranolaError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export type GranolaPerson = { name?: string | null; email?: string | null };
export type GranolaTranscriptEntry = { speaker?: { source?: string | null; name?: string | null; diarization_label?: string | null } | null; text?: string | null; start_time?: string | null };
export type GranolaNote = {
  id: string; title?: string | null; owner?: GranolaPerson | null; attendees?: GranolaPerson[] | null; created_at?: string | null; updated_at?: string | null;
  web_url?: string | null; summary_text?: string | null; summary_markdown?: string | null; transcript?: GranolaTranscriptEntry[] | null;
  calendar_event?: { event_title?: string | null; scheduled_start_time?: string | null } | null;
};
export type GranolaList = { notes: { id: string; title?: string | null; created_at?: string | null }[]; hasMore: boolean; cursor: string | null };
export type GranolaWebhook = { id: string; signing_secret?: string; scopes?: string[]; events?: string[] };

export function granolaApi(key: string, f: typeof fetch = fetch) {
  const call = async <T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> => {
    const r = await f(`${granolaApiUrl()}${path}`, {
      method, headers: { authorization: `Bearer ${key}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) {
      const j = (await r.json().catch(() => null)) as { message?: string; error?: string } | null;
      throw new GranolaError(r.status, `Granola ${r.status}${j?.message || j?.error ? `: ${j.message ?? j.error}` : ""}`);
    }
    return (await r.json()) as T;
  };
  return {
    listNotes(q: { created_after?: string; cursor?: string | null; page_size?: number } = {}) {
      const p = new URLSearchParams();
      if (q.created_after) p.set("created_after", q.created_after);
      if (q.cursor) p.set("cursor", q.cursor);
      p.set("page_size", String(q.page_size ?? 30));
      return call<GranolaList>("GET", `/v1/notes?${p.toString()}`);
    },
    /** The note with its transcript; a transcript too large to return inline (413) falls back to the note without it. */
    async getNote(id: string): Promise<GranolaNote> {
      try {
        return await call<GranolaNote>("GET", `/v1/notes/${encodeURIComponent(id)}?include=transcript`);
      } catch (e) {
        if (e instanceof GranolaError && e.status === 413) return call<GranolaNote>("GET", `/v1/notes/${encodeURIComponent(id)}`);
        throw e;
      }
    },
    createWebhook(body: { url: string; scopes: string[]; events: string[] }) {
      return call<GranolaWebhook>("POST", "/v1/webhook-endpoints", body);
    },
    deleteWebhook(id: string) {
      return call<unknown>("DELETE", `/v1/webhook-endpoints/${encodeURIComponent(id)}`);
    },
  };
}
export type GranolaApi = ReturnType<typeof granolaApi>;

/** What to tell the admin when Granola refuses a key. */
export function granolaKeyError(e: unknown): string {
  if (e instanceof GranolaError && e.status === 401) return "Granola didn't accept that key. Check it was copied in full.";
  if (e instanceof GranolaError && e.status === 403) return "That key can't use Granola's API. The API needs Granola's Business plan; a workspace key is best.";
  if (e instanceof GranolaError) return `Granola answered ${e.status}. Try again in a moment.`;
  return "Couldn't reach Granola. Try again in a moment.";
}
