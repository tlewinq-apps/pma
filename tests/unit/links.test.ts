import { describe, it, expect } from "vitest";
import { slugify, slugProblem, appHref, inAppPath, safeNext, queryOf } from "@/lib/links";

describe("links", () => {
  it("slugify normalises names", () => {
    expect(slugify("Café Co")).toBe("cafe-co"); expect(slugify("  Acme, Inc.  ")).toBe("acme-inc"); expect(slugify("x".repeat(60))).toHaveLength(40);
  });
  it("slugify never ends with a dash after the 40-character cap", () => {
    const s = slugify("a".repeat(39) + " x");
    expect(s).toBe("a".repeat(39));
    expect(s.endsWith("-")).toBe(false);
  });
  it("slugProblem refuses reserved and malformed slugs", () => {
    expect(slugProblem("admin")).toBe("slug_reserved"); expect(slugProblem("settings")).toBe("slug_reserved");
    expect(slugProblem("Acme")).toBe("slug_invalid"); expect(slugProblem("-acme")).toBe("slug_invalid"); expect(slugProblem("acme")).toBeNull();
  });
  it("appHref joins the app base with in-app paths, keeping query and hash", () => {
    expect(appHref("/demo/celeste", "/")).toBe("/demo/celeste");
    expect(appHref("/demo/celeste", "/issues/1?from=bug#x")).toBe("/demo/celeste/issues/1?from=bug#x");
    expect(appHref("/demo/celeste", "/?focus=1")).toBe("/demo/celeste?focus=1");
  });
  it("inAppPath strips the app base, leaving other paths alone", () => {
    const base = "/demo/celeste";
    expect(inAppPath("/demo/celeste", base)).toBe("/");
    expect(inAppPath("/demo/celeste/", base)).toBe("/");
    expect(inAppPath("/demo/celeste/issues/1", base)).toBe("/issues/1");
    expect(inAppPath("/Demo/Celeste/work", base)).toBe("/work");
    expect(inAppPath("/demo/celeste-two/work", base)).toBe("/demo/celeste-two/work");
    expect(inAppPath("/sign-in", base)).toBe("/sign-in");
  });
  it("safeNext only allows same-site relative paths", () => {
    expect(safeNext("/invite/abc")).toBe("/invite/abc");
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "", null]) expect(safeNext(bad as string | null)).toBeNull();
  });
  it("safeNext refuses tab and newline tricks that browsers read as //host", () => {
    expect(safeNext("/\t/evil.com")).toBeNull();
    expect(safeNext("/\n/evil.com")).toBeNull();
  });
  it("queryOf gives a redirect the query it was opened with", () => {
    expect(queryOf({})).toBe("");
    expect(queryOf({ why: "1" })).toBe("?why=1");
    expect(queryOf({ view: "bugs", focus: "a b" })).toBe("?view=bugs&focus=a+b");
    expect(queryOf({ tag: ["x", "y"], gone: undefined })).toBe("?tag=x&tag=y");
    expect(queryOf({ q: "a&b=c#d" })).toBe("?q=a%26b%3Dc%23d");
  });
  it("queryOf can leave out a parameter the redirect has already used", () => {
    expect(queryOf({ issue: "1", view: "bugs" }, "issue")).toBe("?view=bugs");
    expect(queryOf({ issue: "1" }, "issue")).toBe("");
  });
});
