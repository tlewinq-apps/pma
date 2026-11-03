// Sentry's API (https://docs.sentry.io/api/), read-only, with a person's auth token (org:read, project:read,
// event:read): the organizations the token reaches, each one's projects, and a project's issues. Organizations live
// in a region (us.sentry.io, de.sentry.io), which their listing names; every call after it goes to that region. A
// self-hosted Sentry is one address for everything. Lists page through the Link header.

export const SENTRY_URL = "https://sentry.io";
const MAX_PAGES = 5;

export class SentryError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
  /** The token was refused or lacks a scope: the connection needs a new one. */
  get denied() { return this.status === 401 || this.status === 403; }
}

export type SentryOrg = { slug: string; name: string; regionUrl: string };
export type SentryProject = { id: string; slug: string; name: string };
export type SentryIssue = {
  id: string; shortId: string | null; title: string; culprit: string | null; permalink: string | null; count: number; userCount: number;
  firstSeen: string | null; lastSeen: string | null; category: string | null; metadata: Record<string, unknown>;
};

/** What to tell the admin about a pasted token before any call, or null when it looks like a token that can read issues. */
export function sentryTokenProblem(token: string): string | null {
  if (/^sntrys_/.test(token)) return "That's an organization token, which can't read issues. Make a personal token in Sentry under User settings, Personal Tokens.";
  if (!/^[A-Za-z0-9_=.-]{20,400}$/.test(token)) return "That doesn't look like a Sentry token. Make one in Sentry under User settings, Personal Tokens.";
  return null;
}

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|.*\.localhost)$|^\d+\.\d+\.\d+\.\d+$|^\[|:/i;

/**
 * A self-hosted Sentry's address as the origin PMA calls, or null when it isn't an https origin on a public name. PMA's
 * server fetches it, so private hosts and bare IP addresses are refused.
 */
export function sentryBaseUrl(v: string): string | null {
  let u: URL;
  try { u = new URL(v.trim()); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || PRIVATE_HOST.test(u.hostname) || !u.hostname.includes(".")) return null;
  return u.origin;
}

/** An organization's region address, kept only when it belongs to the Sentry the token was checked against. */
export function regionUrlFor(base: string, regionUrl: unknown): string {
  if (typeof regionUrl !== "string") return base;
  try {
    const r = new URL(regionUrl), b = new URL(base);
    const ours = r.hostname === b.hostname || (b.hostname === "sentry.io" && r.hostname.endsWith(".sentry.io"));
    return r.protocol === "https:" && ours ? r.origin : base;
  } catch {
    return base;
  }
}

/** The next page's URL from a Link header, or null on the last page (results="false"). */
export function nextLink(header: string | null): string | null {
  for (const part of (header ?? "").split(/,(?=\s*<)/)) {
    const url = /<([^>]+)>/.exec(part)?.[1];
    if (url && /rel="next"/.test(part) && /results="true"/.test(part)) return url;
  }
  return null;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => { const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? n : 0; };

/** One issue from the API, read defensively: counts arrive as strings, and anything may be missing. */
export function issueOf(raw: Record<string, unknown>): SentryIssue | null {
  const id = str(raw.id);
  if (!id || !/^\d{1,30}$/.test(id)) return null;
  const metadata = raw.metadata && typeof raw.metadata === "object" ? (raw.metadata as Record<string, unknown>) : {};
  const permalink = str(raw.permalink);
  return {
    id, shortId: str(raw.shortId), title: (str(raw.title) ?? str(metadata.title) ?? "Unnamed error").replace(/\s+/g, " ").slice(0, 300),
    culprit: str(raw.culprit), permalink: permalink?.startsWith("https://") ? permalink : null, count: num(raw.count), userCount: num(raw.userCount),
    firstSeen: str(raw.firstSeen), lastSeen: str(raw.lastSeen), category: str(raw.issueCategory), metadata,
  };
}

/**
 * What someone wrote through Sentry's User Feedback. A feedback issue keeps the message in its metadata (Sentry's
 * docs don't pin the field, so the known names are tried in turn) and names the person when they gave a name.
 */
export function feedbackOf(issue: SentryIssue): { message: string; name: string | null; email: string | null } | null {
  const m = issue.metadata;
  const message = (str(m.message) ?? str(m.value) ?? (issue.title !== "User Feedback" ? issue.title : null))?.trim();
  if (!message) return null;
  return { message: message.slice(0, 20_000), name: str(m.name), email: str(m.contact_email) ?? str(m.email) };
}

export function sentryApi(token: string, f: typeof fetch = fetch) {
  const get = async <T>(url: string): Promise<{ body: T; next: string | null }> => {
    const r = await f(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) {
      const j = (await r.json().catch(() => null)) as { detail?: string } | null;
      throw new SentryError(r.status, `Sentry ${r.status}${j?.detail ? `: ${j.detail}` : ""}`);
    }
    return { body: (await r.json()) as T, next: nextLink(r.headers.get("link")) };
  };
  /** Every page of a list, up to MAX_PAGES (or `limit` items). */
  const all = async <T>(url: string, limit = Infinity): Promise<T[]> => {
    const out: T[] = [];
    let next: string | null = url;
    for (let page = 0; next && page < MAX_PAGES && out.length < limit; page++) {
      const r: { body: T[]; next: string | null } = await get<T[]>(next);
      out.push(...(Array.isArray(r.body) ? r.body : []));
      next = r.next;
    }
    return out.slice(0, limit);
  };
  return {
    /** The organizations the token reaches, each with the region its data lives in. */
    async organizations(base: string): Promise<SentryOrg[]> {
      const orgs = await all<Record<string, unknown>>(`${base}/api/0/organizations/`);
      return orgs.flatMap((o) => {
        const slug = str(o.slug);
        if (!slug) return [];
        const links = (o.links ?? {}) as Record<string, unknown>;
        return [{ slug, name: str(o.name) ?? slug, regionUrl: regionUrlFor(base, links.regionUrl) }];
      });
    },
    async projects(org: SentryOrg): Promise<SentryProject[]> {
      const ps = await all<Record<string, unknown>>(`${org.regionUrl}/api/0/organizations/${encodeURIComponent(org.slug)}/projects/`);
      return ps.flatMap((p) => {
        const id = str(p.id), slug = str(p.slug);
        return id && slug ? [{ id, slug, name: str(p.name) ?? slug }] : [];
      });
    },
    /** A project's issues matching `query` over `statsPeriod` (counts are for that period), most people first. */
    async issues(org: { slug: string; regionUrl: string }, projectId: string, query: string, opts: { statsPeriod?: string; limit?: number } = {}): Promise<SentryIssue[]> {
      const q = new URLSearchParams({ project: projectId, query, statsPeriod: opts.statsPeriod ?? "30d", sort: "user", limit: String(Math.min(opts.limit ?? 100, 100)) });
      const raw = await all<Record<string, unknown>>(`${org.regionUrl}/api/0/organizations/${encodeURIComponent(org.slug)}/issues/?${q}`, opts.limit ?? 100);
      return raw.map(issueOf).filter((i): i is SentryIssue => !!i);
    },
  };
}
export type SentryApi = ReturnType<typeof sentryApi>;

/** What to tell the admin when Sentry refuses or can't be reached. */
export function sentryErrorText(e: unknown): string {
  if (e instanceof SentryError && e.status === 401) return "Sentry didn't accept that token. Check it was copied in full, or make a new one.";
  if (e instanceof SentryError && e.status === 403) return "That token can't read this. Give it the org:read, project:read and event:read scopes.";
  if (e instanceof SentryError) return `Sentry answered ${e.status}. Try again in a moment.`;
  return "Couldn't reach Sentry. Try again in a moment.";
}
