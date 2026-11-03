import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS, SLUG_PATTERN } from "@/lib/links";

// The database checks slugs in SQL (public.slug_problem) with a copy of src/lib/links.ts. The two must agree, or a slug
// the form accepts is refused by the database (or the other way round). Migrations replace the function over time
// (0018_orgs.sql, then 0021_reserved_slugs.sql, ...), so compare against the latest one that defines it.
const DIR = path.resolve(import.meta.dirname, "../../supabase/migrations");
const defining = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()
  .filter((f) => /create\s+or\s+replace\s+function\s+public\.slug_problem\s*\(/i.test(readFileSync(path.join(DIR, f), "utf8")));
const latest = defining.at(-1)!;
const sql = readFileSync(path.join(DIR, latest), "utf8");

describe(`slug rules in SQL (${latest}) match src/lib/links.ts`, () => {
  const reserved = sql.match(/when p_slug = any \(array\[([^\]]+)\]\)/);

  it("finds the migrations that define slug_problem, newest last", () => {
    expect(defining[0]).toBe("0018_orgs.sql");
    expect(defining.length).toBeGreaterThanOrEqual(2);
  });

  it("reserves exactly the same slugs", () => {
    expect(reserved, "reserved array not found in slug_problem").not.toBeNull();
    const inSql = [...reserved![1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
    expect(inSql.sort()).toEqual([...RESERVED_SLUGS].sort());
    for (const slug of RESERVED_SLUGS) expect(sql).toContain(`'${slug}'`);
  });

  it("reserves the paths next.config.ts redirects (/sources)", () => {
    expect(RESERVED_SLUGS.has("sources")).toBe(true);
  });

  it("uses the same pattern, checked after the reserved list", () => {
    const pattern = `'${SLUG_PATTERN.source}'`;
    expect(sql).toContain(pattern);
    // Reserved first, so "_next" reports slug_reserved rather than slug_invalid, as slugProblem does.
    expect(sql.indexOf(pattern)).toBeGreaterThan(sql.indexOf(reserved![0]));
  });

  it("keeps the function's empty search_path and service-role-only execute grant", () => {
    expect(sql).toMatch(/function public\.slug_problem\(p_slug text\) returns text\s+language sql immutable set search_path = ''/);
    expect(sql).toContain("revoke execute on function public.slug_problem(text) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.slug_problem(text) to service_role;");
  });
});
