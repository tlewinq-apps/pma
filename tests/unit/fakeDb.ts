/* eslint-disable @typescript-eslint/no-explicit-any -- a stand-in for the untyped Supabase query builder */
// A small in-memory stand-in for the Supabase client, for unit tests of server code that reads with the service role.
// Tables are arrays of rows (nested selects are pre-joined in the rows themselves); filters understand JSON paths
// ("metadata->slack->>channel"). Writes are recorded in `writes` and answered with success; they change nothing.
type Row = Record<string, any>;
type Filter = (row: Row) => boolean;
export type Write = { table: string; op: "insert" | "update" | "upsert" | "delete"; values?: unknown };

const at = (row: Row, col: string) => col.split(/->>?|\./).reduce<any>((v, k) => (v == null ? v : v[k]), row);
const likeRe = (pattern: string, flags = "") => new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, flags);

export function fakeDb(tables: Record<string, Row[]>, rpcs: Record<string, unknown> = {}) {
  const writes: Write[] = [];
  const reads: { table: string; filters: string[] }[] = [];

  function from(table: string) {
    let op: "select" | Write["op"] = "select";
    let values: unknown;
    let head = false;
    const filters: Filter[] = [];
    const described: string[] = [];
    const add = (desc: string, f: Filter) => { described.push(desc); filters.push(f); return q; };

    const run = async (one: "single" | "maybe" | null) => {
      if (op !== "select") { writes.push({ table, op, values }); return { data: null, error: null }; }
      reads.push({ table, filters: described });
      const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (head) return { data: null, count: rows.length, error: null };
      if (one === "single") return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: `${rows.length} rows` } };
      if (one === "maybe") return rows.length <= 1 ? { data: rows[0] ?? null, error: null } : { data: null, error: { message: "more than one row" } };
      return { data: rows, error: null };
    };

    const q: any = {
      select: (_cols?: string, opts?: { head?: boolean }) => { if (opts?.head) head = true; return q; },
      insert: (v: unknown) => { op = "insert"; values = v; return q; },
      update: (v: unknown) => { op = "update"; values = v; return q; },
      upsert: (v: unknown) => { op = "upsert"; values = v; return q; },
      delete: () => { op = "delete"; return q; },
      eq: (c: string, v: unknown) => add(`${c}=${String(v)}`, (r) => at(r, c) === v),
      neq: (c: string, v: unknown) => add(`${c}!=${String(v)}`, (r) => at(r, c) !== v),
      in: (c: string, vs: unknown[]) => add(`${c} in`, (r) => vs.includes(at(r, c))),
      like: (c: string, p: string) => add(`${c} like ${p}`, (r) => likeRe(p).test(String(at(r, c) ?? ""))),
      ilike: (c: string, p: string) => add(`${c} ilike ${p}`, (r) => likeRe(p, "i").test(String(at(r, c) ?? ""))),
      is: (c: string, v: unknown) => add(`${c} is ${String(v)}`, (r) => (at(r, c) ?? null) === v),
      lt: (c: string, v: any) => add(`${c}<${String(v)}`, (r) => at(r, c) < v),
      lte: (c: string, v: any) => add(`${c}<=${String(v)}`, (r) => at(r, c) <= v),
      gt: (c: string, v: any) => add(`${c}>${String(v)}`, (r) => at(r, c) > v),
      gte: (c: string, v: any) => add(`${c}>=${String(v)}`, (r) => at(r, c) >= v),
      not: (c: string, o: string, v: unknown) => add(`${c} not ${o}`, (r) => (o === "is" ? (at(r, c) ?? null) !== v : at(r, c) !== v)),
      order: () => q,
      limit: () => q,
      single: () => run("single"),
      maybeSingle: () => run("maybe"),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run(null).then(res, rej),
    };
    return q;
  }

  const db = { from, rpc: async (name: string) => ({ data: rpcs[name] ?? null, error: null }) };
  return { db, writes, reads };
}
