// A small PostHog API client for one connected project: the project read, HogQL queries (POST /api/projects/:id/query/)
// and the project list. Credentials are an OAuth token pair (refreshed once on a 401 and saved again through
// onRefresh) or a personal API key (phx_). Every request goes through a token bucket of 240 a minute and at most 3 at
// once per credential, which is PostHog's query limit.

export type Region = "us" | "eu";
export const POSTHOG_HOSTS: Record<Region, string> = { us: "https://us.posthog.com", eu: "https://eu.posthog.com" };
/** The PostHog cloud for a region; POSTHOG_API_URL points every region at a local fake (like SLACK_API_URL). */
export const posthogHost = (region: Region) => (process.env.POSTHOG_API_URL ?? POSTHOG_HOSTS[region]).replace(/\/+$/, "");
export const isRegion = (v: unknown): v is Region => v === "us" || v === "eu";

export type PostHogCredentials =
  | { kind: "oauth"; access_token: string; refresh_token: string | null; expires_at: number | null }
  | { kind: "key"; key: string };

export class PostHogError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
  /** PostHog no longer accepts these credentials (or they can't see the project). */
  get denied() { return this.status === 401 || this.status === 403; }
}

type Fetch = typeof fetch;

/** A token bucket (240 a minute, refilled continuously) and a cap on requests in flight (3). */
export class RateLimiter {
  private tokens: number;
  private last: number;
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(readonly perMinute = 240, readonly concurrent = 3, private now: () => number = Date.now, private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {
    this.tokens = perMinute;
    this.last = now();
  }
  private refill() {
    const t = this.now();
    this.tokens = Math.min(this.perMinute, this.tokens + ((t - this.last) / 60_000) * this.perMinute);
    this.last = t;
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrent) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      this.refill();
      while (this.tokens < 1) {
        await this.sleep(Math.ceil(((1 - this.tokens) / this.perMinute) * 60_000));
        this.refill();
      }
      this.tokens -= 1;
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
  get inFlight() { return this.active; }
}

const limiters = new Map<string, RateLimiter>();
/** One limiter per credential in this process, so parallel syncs of one company share the budget. */
export function limiterFor(key: string): RateLimiter {
  let l = limiters.get(key);
  if (!l) limiters.set(key, (l = new RateLimiter()));
  return l;
}

export type QueryResult = { columns: string[]; results: unknown[][] };
export type PostHogProject = { id: number; name: string };

export class PostHogApi {
  constructor(
    readonly host: string,
    private creds: PostHogCredentials,
    private opts: { fetch?: Fetch; limiter?: RateLimiter; refresh?: (refreshToken: string) => Promise<PostHogCredentials>; onRefresh?: (c: PostHogCredentials) => Promise<void> } = {},
  ) {}

  private token() { return this.creds.kind === "oauth" ? this.creds.access_token : this.creds.key; }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, retried = false): Promise<T> {
    const run = () => (this.opts.fetch ?? fetch)(`${this.host}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token()}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const r = await (this.opts.limiter ? this.opts.limiter.run(run) : run());
    if (r.status === 401 && !retried && this.creds.kind === "oauth" && this.creds.refresh_token && this.opts.refresh) {
      this.creds = await this.opts.refresh(this.creds.refresh_token);
      await this.opts.onRefresh?.(this.creds);
      return this.request<T>(method, path, body, true);
    }
    if (!r.ok) {
      const j = (await r.json().catch(() => null)) as { detail?: string } | null;
      throw new PostHogError(r.status, j?.detail ? `PostHog ${r.status}: ${j.detail}` : `PostHog answered ${r.status}`);
    }
    return (await r.json()) as T;
  }

  /** The projects these credentials can see. */
  async projects(): Promise<PostHogProject[]> {
    const pick = (j: { results?: { id: number; name: string }[] } | { id: number; name: string }[]) =>
      (Array.isArray(j) ? j : j.results ?? []).filter((p) => typeof p?.id === "number").map((p) => ({ id: p.id, name: String(p.name ?? p.id) }));
    try {
      return pick(await this.request("GET", "/api/projects/"));
    } catch (e) {
      if (!(e instanceof PostHogError) || e.status !== 404) throw e;
      return pick(await this.request("GET", "/api/organizations/@current/projects/"));
    }
  }

  async project(id: number): Promise<PostHogProject> {
    const p = await this.request<{ id: number; name: string }>("GET", `/api/projects/${id}/`);
    return { id: p.id, name: p.name };
  }

  /** A HogQL query against the project's events. */
  async query(projectId: number, hogql: string): Promise<QueryResult> {
    const j = await this.request<{ columns?: string[]; results?: unknown[][] }>("POST", `/api/projects/${projectId}/query/`, { query: { kind: "HogQLQuery", query: hogql } });
    return { columns: j.columns ?? [], results: j.results ?? [] };
  }
}
