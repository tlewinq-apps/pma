// A company's connections to outside tools (supabase/migrations/0030_connections.sql), server side only. Rows are read
// and written with the service role after the route has checked who is asking; secrets go to Vault through the
// connection_secret_* RPCs and never into a row, a log line or a response.
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";

export type ConnectionKind = "anthropic" | "slack" | "posthog" | "granola" | "marver" | "github" | "sentry";
export type ConnectionStatus = "pending" | "ok" | "broken" | "revoked" | "disconnected";

/** Tools that belong to the company (every app uses them); the others are set per app. */
export const COMPANY_LEVEL: ReadonlySet<ConnectionKind> = new Set(["anthropic", "slack", "granola", "github"]);

export type Connection = {
  id: string; org_id: string; project_id: string | null; kind: ConnectionKind; status: ConnectionStatus; status_reason: string | null;
  display: Record<string, unknown>; config: Record<string, unknown>; external_id: string | null; secret_id: string | null;
  updated_at: string; verified_at: string | null;
};

const COLS = "id, org_id, project_id, kind, status, status_reason, display, config, external_id, secret_id, updated_at, verified_at";

/** The row for this tool at its level: the company's for company-level tools, else the app's. */
export async function findConnection(kind: ConnectionKind, scope: { orgId: string; projectId: string | null }, db: SupabaseClient = serviceDb()): Promise<Connection | null> {
  let q = db.from("connections").select(COLS).eq("org_id", scope.orgId).eq("kind", kind);
  q = COMPANY_LEVEL.has(kind) || !scope.projectId ? q.is("project_id", null) : q.eq("project_id", scope.projectId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`connection lookup failed: ${error.message}`);
  return (data as Connection | null) ?? null;
}

export async function connectionById(id: string, db: SupabaseClient = serviceDb()): Promise<Connection | null> {
  const { data, error } = await db.from("connections").select(COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(`connection lookup failed: ${error.message}`);
  return (data as Connection | null) ?? null;
}

/** Creates or updates the tool's row. `display` and `config` replace what was there; neither may hold a secret. */
export async function saveConnection(
  kind: ConnectionKind,
  scope: { orgId: string; projectId: string | null },
  fields: { status: ConnectionStatus; display?: Record<string, unknown>; config?: Record<string, unknown>; externalId?: string | null; reason?: string | null; userId?: string | null; verified?: boolean },
  db: SupabaseClient = serviceDb(),
): Promise<Connection> {
  const projectId = COMPANY_LEVEL.has(kind) ? null : scope.projectId;
  const now = new Date().toISOString();
  const values = {
    status: fields.status, status_reason: fields.reason ?? null, updated_at: now,
    ...(fields.display ? { display: fields.display } : {}), ...(fields.config ? { config: fields.config } : {}),
    ...(fields.externalId !== undefined ? { external_id: fields.externalId } : {}), ...(fields.verified ? { verified_at: now } : {}),
  };
  const existing = await findConnection(kind, { orgId: scope.orgId, projectId }, db);
  if (existing) {
    const { data, error } = await db.from("connections").update(values).eq("id", existing.id).select(COLS).single();
    if (error) throw new Error(`connection update failed: ${error.message}`);
    return data as Connection;
  }
  const { data, error } = await db.from("connections")
    .insert({ org_id: scope.orgId, project_id: projectId, kind, created_by: fields.userId ?? null, ...values })
    .select(COLS).single();
  if (error?.code === "23505") return saveConnection(kind, scope, fields, db); // made by a concurrent request: update it
  if (error) throw new Error(`connection insert failed: ${error.message}`);
  return data as Connection;
}

/** Marks a connection's health without touching anything else (a 401 from the tool, an uninstall). */
export async function markConnection(id: string, status: ConnectionStatus, reason: string | null, db: SupabaseClient = serviceDb()): Promise<void> {
  const { error } = await db.from("connections").update({ status, status_reason: reason, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(`connection update failed: ${error.message}`);
}

/** Stores the secret in Vault. Objects are stored as JSON (an OAuth token pair, a key plus a webhook secret). */
export async function putSecret(id: string, secret: string | Record<string, unknown>, db: SupabaseClient = serviceDb()): Promise<void> {
  const { error } = await db.rpc("connection_secret_set", { p_connection: id, p_secret: typeof secret === "string" ? secret : JSON.stringify(secret) });
  if (error) throw new Error(`storing the secret failed: ${error.message}`);
}

export async function readSecret(id: string, db: SupabaseClient = serviceDb()): Promise<string | null> {
  const { data, error } = await db.rpc("connection_secret_get", { p_connection: id });
  if (error) throw new Error(`reading the secret failed: ${error.message}`);
  return (data as string | null) ?? null;
}

/** The secret as the JSON object it was stored as, or null when it's missing or not an object. */
export async function readSecretJson<T extends Record<string, unknown>>(id: string, db: SupabaseClient = serviceDb()): Promise<T | null> {
  const raw = await readSecret(id, db);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as T) : null;
  } catch {
    return null;
  }
}

export async function dropSecret(id: string, db: SupabaseClient = serviceDb()): Promise<void> {
  const { error } = await db.rpc("connection_secret_drop", { p_connection: id });
  if (error) throw new Error(`dropping the secret failed: ${error.message}`);
}

/** Disconnect: forget the secret and keep the row, so the card says "Not connected" and connecting again reuses it. */
export async function disconnect(id: string, db: SupabaseClient = serviceDb()): Promise<void> {
  await dropSecret(id, db);
  const { error } = await db.from("connections").update({ status: "disconnected", status_reason: null, config: {}, external_id: null, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(`connection update failed: ${error.message}`);
}

export type AuditEntry = { orgId: string; projectId?: string | null; actorId?: string | null; action: string; target: ConnectionKind | string; detail?: Record<string, unknown> };

/** One audit line (connections, uninstalls, broken keys). Best effort: a failed write is logged, never thrown. */
export async function audit(e: AuditEntry, db: SupabaseClient = serviceDb()): Promise<void> {
  const { error } = await db.from("audit_log").insert({ org_id: e.orgId, project_id: e.projectId ?? null, actor_id: e.actorId ?? null, action: e.action, target: e.target, detail: e.detail ?? {} });
  if (error) console.error("[audit] write failed", e.action, error.message);
}

/** The last four characters of a key, for "ending in 1a2b". */
export const last4 = (secret: string) => secret.slice(-4);
