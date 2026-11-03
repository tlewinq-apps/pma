import { it, expect, vi, afterEach } from "vitest";
import { isProdUrl, assertNotProd } from "../../scripts/lib/guard";

const PROD = "prodprodprodprodprod";
afterEach(() => vi.unstubAllEnvs());
it("recognises the production project by its ref", () => {
  vi.stubEnv("PMA_PROD_SUPABASE_REF", PROD);
  expect(isProdUrl(`https://${PROD}.supabase.co`)).toBe(true);
  expect(isProdUrl("https://abcdefdevproject.supabase.co")).toBe(false);
  expect(isProdUrl(undefined)).toBe(false);
});
it("treats no project as production until PMA_PROD_SUPABASE_REF names one", () => {
  vi.stubEnv("PMA_PROD_SUPABASE_REF", "");
  expect(isProdUrl(`https://${PROD}.supabase.co`)).toBe(false);
});
it("blocks scripts on production unless PMA_ALLOW_PROD=1", () => {
  vi.stubEnv("PMA_PROD_SUPABASE_REF", PROD);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${PROD}.supabase.co`);
  expect(() => assertNotProd("seed")).toThrow(/seed refuses to run against production/);
  vi.stubEnv("PMA_ALLOW_PROD", "1");
  expect(() => assertNotProd("seed")).not.toThrow();
});
it("names the host it refused and how to allow it", () => {
  vi.stubEnv("PMA_PROD_SUPABASE_REF", PROD);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${PROD}.supabase.co`);
  expect(() => assertNotProd("seed")).toThrow(
    `seed refuses to run against production (${PROD}.supabase.co). Set PMA_ALLOW_PROD=1 if you really mean it.`,
  );
});
