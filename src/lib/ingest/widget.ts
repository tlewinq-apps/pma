export const WIDGET_MAX_CHARS = 5000;
export function validateWidgetRequest(
  body: unknown, origin: string | null, project: { widget_origins: string[] } | null,
): { ok: true; text: string; route: string | null; user: string | null } | { ok: false; status: 400 | 403 | 404 | 413; error: string } {
  if (!project) return { ok: false, status: 404, error: "unknown widget key" };
  if (project.widget_origins.length && (!origin || !project.widget_origins.includes(origin))) return { ok: false, status: 403, error: "origin not allowed" };
  const b = (body ?? {}) as { text?: unknown; route?: unknown; user?: unknown };
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) return { ok: false, status: 400, error: "text required" };
  if (text.length > WIDGET_MAX_CHARS) return { ok: false, status: 413, error: "text too long" };
  return { ok: true, text, route: typeof b.route === "string" ? b.route.slice(0, 500) : null, user: typeof b.user === "string" ? b.user.slice(0, 200) : null };
}

export const DEFAULT_WIDGET_DAILY_CAP = 200;
/** Parse WIDGET_DAILY_CAP; falls back to the default for missing, non-numeric or negative values. */
export function parseWidgetCap(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_WIDGET_DAILY_CAP;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_WIDGET_DAILY_CAP;
}
export const widgetCapExceeded = (count: number, cap: number): boolean => count >= cap;
