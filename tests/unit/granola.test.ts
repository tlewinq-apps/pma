// Granola (src/lib/granola/*): the key is checked and the webhook registered per company; each delivery's Standard
// Webhooks signature is checked against that company's own secret; a note becomes one 'granola' source in the
// company's default app, with its transcript and attendees; the catch-up brings what the webhook missed. Granola is a
// fake fetch here.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "./fakeDb";

const h = vi.hoisted(() => ({
  db: null as unknown,
  saved: [] as { status: string; config?: Record<string, unknown>; display?: Record<string, unknown> }[],
  secret: null as Record<string, unknown> | null,
  conn: null as Record<string, unknown> | null,
  enqueued: [] as { projectId: string; input: Record<string, unknown> }[],
  ran: [] as string[],
}));
vi.mock("@/lib/db/server", () => ({ serviceDb: () => h.db }));
vi.mock("@/lib/connections/store", async (orig) => ({
  ...(await orig<typeof import("@/lib/connections/store")>()),
  findConnection: async () => h.conn,
  connectionById: async (id: string) => (h.conn?.id === id ? h.conn : null),
  saveConnection: async (_k: string, _s: unknown, f: { status: string; config?: Record<string, unknown>; display?: Record<string, unknown> }) => { h.saved.push(f); return { id: "conn-g", ...f }; },
  putSecret: async (_id: string, s: Record<string, unknown>) => { h.secret = s; },
  readSecretJson: async () => h.secret,
  markConnection: async () => {},
  disconnect: async () => {},
  audit: async () => {},
}));
vi.mock("@/lib/ingest/enqueue", () => ({
  enqueueSource: async (projectId: string, input: Record<string, unknown>) => {
    const dup = h.enqueued.some((e) => e.input.hashKey === input.hashKey);
    h.enqueued.push({ projectId, input });
    return { id: `src-${h.enqueued.length}`, duplicate: dup };
  },
}));
vi.mock("@/lib/pipeline/deps", () => ({ runSource: async (id: string) => { h.ran.push(id); } }));
// after() runs the work once the response is sent; here it runs straight away.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => Promise<void>) => { void fn(); } }));

import { connectGranola, granolaCatchUp, noteToSource } from "@/lib/granola/notes";
import { signStandardWebhook, verifyStandardWebhook } from "@/lib/granola/webhook";
import { POST as webhook } from "@/app/api/granola/webhook/[connectionId]/route";

const SECRET = `whsec_${Buffer.from("a-very-secret-signing-key-123456").toString("base64")}`;
const KEY = "grn_abcdefghijklmnopqrstuvwxyz";
const CONN = "11111111-2222-4333-8444-555555555555";
const note = {
  id: "not_1d3tmYTlCICgjy", title: "Checkout interview", owner: { name: "Priya PM", email: "priya@acme.test" },
  attendees: [{ name: "Sam Shopper", email: "sam@example.test" }, { name: null, email: null }],
  created_at: "2026-10-15T10:00:00Z", web_url: "https://notes.granola.ai/d/x", summary_markdown: "Sam couldn't pay.",
  calendar_event: { event_title: "Customer call", scheduled_start_time: "2026-10-15T09:30:00Z" },
  transcript: [
    { speaker: { source: "microphone" }, text: "How did checkout go?" },
    { speaker: { source: "speaker", diarization_label: "B" }, text: "The pay button did nothing on my phone." },
    { speaker: { source: "speaker", name: "Sam Shopper" }, text: "  " },
  ],
};

/** A fake Granola: answers by method and path, and records what it was asked. */
function granola(over: Partial<Record<string, (body: unknown) => Response>> = {}) {
  const calls: { method: string; path: string; body: unknown; auth: string | null }[] = [];
  const f = vi.fn(async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const key = `${init.method} ${u.pathname}`;
    const body = init.body ? JSON.parse(init.body as string) : null;
    calls.push({ method: init.method!, path: u.pathname + u.search, body, auth: (init.headers as Record<string, string>).authorization ?? null });
    const handler = over[key];
    if (handler) return handler(body);
    if (key === "GET /v1/notes") return Response.json({ notes: [{ id: note.id }], hasMore: false, cursor: null });
    if (key === `GET /v1/notes/${note.id}`) return Response.json(note);
    if (key === "POST /v1/webhook-endpoints") return Response.json({ id: "whe_1", signing_secret: SECRET, scopes: body.scopes });
    return new Response("{}", { status: 404 });
  });
  return { f: f as unknown as typeof fetch, calls };
}

const who = { orgId: "org-1", projectId: "app-1", userId: "u1" };
beforeEach(() => {
  h.saved = []; h.secret = null; h.conn = null; h.enqueued = []; h.ran = [];
  h.db = fakeDb({ projects: [{ id: "app-1", org_id: "org-1", created_at: "2026-01-01" }, { id: "app-2", org_id: "org-1", created_at: "2026-02-01" }] }).db;
});

describe("connecting", () => {
  it("checks the key, registers the webhook for this deployment and keeps both secrets in Vault", async () => {
    const g = granola();
    expect(await connectGranola(who, KEY, { appUrl: "https://pma.example.com", f: g.f })).toEqual({ ok: true, webhook: true });
    expect(g.calls[0]).toMatchObject({ method: "GET", path: "/v1/notes?page_size=1", auth: `Bearer ${KEY}` });
    expect(g.calls[1]).toMatchObject({ method: "POST", path: "/v1/webhook-endpoints", body: { url: "https://pma.example.com/api/granola/webhook/conn-g", scopes: ["workspace"], events: ["note.generated", "note.access_granted"] } });
    expect(h.secret).toEqual({ api_key: KEY, webhook_secret: SECRET, webhook_id: "whe_1" });
    expect(h.saved.at(-1)).toMatchObject({ status: "ok", display: { last4: "wxyz", webhook: true }, config: { webhook_id: "whe_1", default_project_id: "app-1" } });
    expect(JSON.stringify(h.saved)).not.toContain(KEY);
  });

  it("falls back to a personal key's scopes when the workspace scope is refused", async () => {
    let first = true;
    const g = granola({ "POST /v1/webhook-endpoints": (body) => {
      if (first) { first = false; return new Response(JSON.stringify({ message: "workspace scope needs a workspace key" }), { status: 400 }); }
      return Response.json({ id: "whe_2", signing_secret: SECRET, scopes: (body as { scopes: string[] }).scopes });
    } });
    expect(await connectGranola(who, KEY, { appUrl: "https://pma.example.com", f: g.f })).toEqual({ ok: true, webhook: true });
    expect(g.calls.filter((c) => c.method === "POST").map((c) => (c.body as { scopes: string[] }).scopes)).toEqual([["workspace"], ["personal", "public"]]);
  });

  it("without a public https URL there's no webhook, and the catch-up brings the notes", async () => {
    const g = granola();
    expect(await connectGranola(who, KEY, { appUrl: "http://localhost:3000", f: g.f })).toEqual({ ok: true, webhook: false });
    expect(g.calls.map((c) => c.method)).toEqual(["GET"]);
    expect(h.secret).toEqual({ api_key: KEY, webhook_secret: null, webhook_id: null });
  });

  it("refuses a key that isn't one, or that Granola refuses, storing nothing", async () => {
    expect(await connectGranola(who, "sk-123", { appUrl: "https://a.example", f: granola().f })).toEqual({ ok: false, error: expect.stringMatching(/starts with grn_/) });
    const g = granola({ "GET /v1/notes": () => new Response("{}", { status: 403 }) });
    expect(await connectGranola(who, KEY, { appUrl: "https://a.example", f: g.f })).toEqual({ ok: false, error: expect.stringMatching(/Business plan/) });
    expect(h.secret).toBeNull();
  });
});

describe("a note as feedback", () => {
  it("is the transcript with who said what, the attendees, and when the meeting was", () => {
    const s = noteToSource(note);
    expect(s.raw_text).toBe("Priya PM: How did checkout go?\nSpeaker B: The pay button did nothing on my phone.");
    expect(s).toMatchObject({ kind: "granola", author: "Priya PM", channel: "Granola: Checkout interview", occurred_at: "2026-10-15T09:30:00Z", hashKey: "granola:not_1d3tmYTlCICgjy" });
    expect((s.metadata.granola as { attendees: unknown[] }).attendees).toEqual([{ name: "Sam Shopper", email: "sam@example.test" }]);
  });

  it("falls back to the summary when there's no transcript", () => {
    expect(noteToSource({ ...note, transcript: null }).raw_text).toBe("Sam couldn't pay.");
  });
});

describe("the webhook", () => {
  const ts = () => String(Math.floor(Date.now() / 1000));
  const deliver = (body: object, sign: { secret?: string; at?: string; id?: string } = {}) => {
    const raw = JSON.stringify(body);
    const at = sign.at ?? ts(), id = sign.id ?? "evt_1";
    return webhook(new Request(`https://x/api/granola/webhook/${CONN}`, { method: "POST", body: raw, headers: { "webhook-id": id, "webhook-timestamp": at, "webhook-signature": signStandardWebhook(sign.secret ?? SECRET, id, at, raw) } }), { params: Promise.resolve({ connectionId: CONN }) });
  };
  beforeEach(() => {
    h.conn = { id: CONN, org_id: "org-1", kind: "granola", status: "ok", config: { default_project_id: "app-2" }, display: {} };
    h.secret = { api_key: KEY, webhook_secret: SECRET, webhook_id: "whe_1" };
    vi.stubGlobal("fetch", granola().f);
  });

  it("verifies Standard Webhooks signatures, including several in one header, and refuses old ones", () => {
    const raw = '{"a":1}', at = ts();
    const sig = signStandardWebhook(SECRET, "evt", at, raw);
    expect(verifyStandardWebhook(SECRET, { id: "evt", timestamp: at, signature: `v1,bm9wZQ== ${sig}` }, raw)).toBe(true);
    expect(verifyStandardWebhook(SECRET, { id: "evt", timestamp: at, signature: sig }, raw + " ")).toBe(false);
    expect(verifyStandardWebhook(SECRET, { id: "evt", timestamp: String(Number(at) - 600), signature: signStandardWebhook(SECRET, "evt", String(Number(at) - 600), raw) }, raw)).toBe(false);
  });

  it("refuses a delivery signed with another company's secret, reading nothing", async () => {
    const other = `whsec_${Buffer.from("another-company-signing-key-0000").toString("base64")}`;
    expect((await deliver({ event_type: "note.generated", note_id: note.id }, { secret: other })).status).toBe(401);
    expect(h.enqueued).toEqual([]);
  });

  it("answers 404 for an endpoint that isn't connected, so Granola stops calling it", async () => {
    h.conn = null;
    expect((await deliver({ event_type: "note.generated", note_id: note.id })).status).toBe(404);
  });

  it("queues the note in the company's default app and runs it", async () => {
    const res = await deliver({ event_id: "evt_9", event_type: "note.generated", note_id: note.id, occurred_at: "2026-10-15T10:01:00Z" }, { id: "evt_9" });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(h.enqueued).toHaveLength(1));
    expect(h.enqueued[0]).toMatchObject({ projectId: "app-2", input: { kind: "granola", hashKey: `granola:${note.id}` } });
    await vi.waitFor(() => expect(h.ran).toEqual(["src-1"]));
  });

  it("ignores events that aren't about a note", async () => {
    expect((await deliver({ event_type: "note.edited", note_id: note.id })).status).toBe(200);
    expect((await deliver({ event_type: "note.generated", note_id: "../../etc" })).status).toBe(200);
    expect(h.enqueued).toEqual([]);
  });
});

describe("the catch-up", () => {
  it("queues notes since the last run once each, and records when it ran", async () => {
    h.conn = { id: CONN, org_id: "org-1", kind: "granola", status: "ok", config: { default_project_id: "app-1", last_sync_at: "2026-10-14T00:00:00Z" }, display: {} };
    h.secret = { api_key: KEY, webhook_secret: null, webhook_id: null };
    const g = granola({ "GET /v1/notes": () => Response.json({ notes: [{ id: note.id }, { id: note.id }], hasMore: false, cursor: null }) });
    vi.stubGlobal("fetch", g.f);
    const r = await granolaCatchUp(CONN, h.db as never, Date.parse("2026-10-16T03:00:00Z"));
    expect(r).toEqual({ queued: 1, seen: 2 });
    expect(g.calls[0].path).toBe("/v1/notes?created_after=2026-10-14T00%3A00%3A00Z&page_size=30");
    expect(h.saved.at(-1)).toMatchObject({ config: { last_sync_at: "2026-10-16T03:00:00.000Z" } });
  });
});
