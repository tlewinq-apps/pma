// Reserved company and app slugs. The same list lives in SQL, in the latest migration that defines public.slug_problem
// (supabase/migrations/0021_reserved_slugs.sql; first 0018_orgs.sql). Change both together: a new migration that
// replaces the function, and this list. tests/unit/slugParity.test.ts fails if they drift.
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "sign-in", "auth", "api", "admin", "invite", "join", "onboarding", "welcome",
  "issues", "feedback", "flows", "projects", "work", "settings", "mock",
  "widget.js", "_next", "favicon.ico", "icon.svg", "no-company", "apps",
  "sources", "oauth", "connections", "status", "billing", "help", "docs",
]);

// The same check slug_problem runs in SQL. Keep the two identical.
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export const SLUG_MESSAGES: Record<"slug_reserved" | "slug_invalid" | "slug_taken", string> = {
  slug_reserved: "That name is reserved. Pick another.",
  slug_invalid: "Use lowercase letters, numbers and dashes, starting and ending with a letter or number (up to 40 characters).",
  slug_taken: "That name is already taken. Pick another.",
};

/** Lowercase, accents removed, runs of other characters become "-", capped at 40, then no leading or trailing "-". */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
}

export function slugProblem(slug: string): "slug_reserved" | "slug_invalid" | null {
  if (RESERVED_SLUGS.has(slug)) return "slug_reserved";
  return SLUG_PATTERN.test(slug) ? null : "slug_invalid";
}

export function appBase(org: string, app: string): string {
  return `/${org}/${app}`;
}

/** Joins an app's base with an in-app path. "/?focus=1" becomes "?focus=1" so the query stays on the base. */
export function appHref(base: string, path: string): string {
  if (path === "/") return base;
  if (path.startsWith("/?") || path.startsWith("/#")) return base + path.slice(1);
  return base + path;
}

/**
 * The query a page was opened with, as "?a=1&b=2" (or "" when there is none), so a redirect can keep it. Takes the
 * `searchParams` a page receives; `without` leaves out one parameter the redirect has already used.
 */
export function queryOf(sp: Record<string, string | string[] | undefined>, without?: string): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (key === without) continue;
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) q.append(key, v);
  }
  const text = q.toString();
  return text ? `?${text}` : "";
}

/** The in-app part of a pathname: "/demo/celeste/issues/1" under that base is "/issues/1", and the base alone is "/". */
export function inAppPath(pathname: string, base: string): string {
  const p = pathname.toLowerCase(), b = base.toLowerCase();
  if (p === b || p === b + "/") return "/";
  return p.startsWith(b + "/") ? pathname.slice(base.length) : pathname;
}

/**
 * Returns `next` only if it is a same-site relative path such as "/invite/abc".
 * A value that starts with a single "/" cannot carry a scheme such as javascript: or https:.
 */
export function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  // Browsers drop tabs and newlines from URLs, so "/\t/evil.com" would load as "//evil.com".
  if (/[\x00-\x1f\x7f]/.test(next)) return null;
  return next;
}
