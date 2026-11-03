import type { Lane } from "@/lib/types";

export const FEEDBACK_MAX_CHARS = 200_000;
export const LANES: readonly Lane[] = ["quick_win", "explore", "watch", "backlog"];

/** The token from an `Authorization: Bearer <token>` header, or null if absent, malformed or empty. */
export function bearerToken(header: string | null): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? "");
  const token = m?.[1].trim();
  return token ? token : null;
}

type Fail = { ok: false; status: 400 | 413; error: string };

/** `?lane=` filter: absent/empty means no filter; anything else must be one of the four lanes. */
export function parseLane(raw: string | null): { ok: true; lane: Lane | null } | Fail {
  if (raw === null || raw === "") return { ok: true, lane: null };
  const lane = LANES.find((l) => l === raw);
  return lane ? { ok: true, lane } : { ok: false, status: 400, error: `lane must be one of ${LANES.join(", ")}` };
}

export type FeedbackInput = { raw_text: string; author: string | null; channel: string; occurred_at: string | null; route: string | null };

/** Validate the POST /api/v1/feedback body. */
export function parseFeedbackBody(body: unknown): { ok: true; input: FeedbackInput } | Fail {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, status: 400, error: "JSON object body required" };
  const b = body as Record<string, unknown>;
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) return { ok: false, status: 400, error: "text required" };
  if (text.length > FEEDBACK_MAX_CHARS) return { ok: false, status: 413, error: "text too long (max 200k chars)" };
  for (const f of ["author", "channel", "route", "occurred_at"] as const) {
    if (b[f] !== undefined && b[f] !== null && typeof b[f] !== "string") return { ok: false, status: 400, error: `${f} must be a string` };
  }
  let occurred_at: string | null = null;
  if (typeof b.occurred_at === "string" && b.occurred_at !== "") {
    const t = Date.parse(b.occurred_at);
    if (Number.isNaN(t)) return { ok: false, status: 400, error: "occurred_at must be an ISO date" };
    occurred_at = new Date(t).toISOString();
  }
  return {
    ok: true,
    input: {
      raw_text: text,
      author: typeof b.author === "string" && b.author ? b.author.slice(0, 200) : null,
      channel: typeof b.channel === "string" && b.channel ? b.channel.slice(0, 200) : "API",
      occurred_at,
      route: typeof b.route === "string" && b.route ? b.route.slice(0, 500) : null,
    },
  };
}
