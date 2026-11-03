import { describe, it, expect } from "vitest";
import { companyRpcArgs, parseCompanyForm } from "@/lib/companyForm";
import { SLUG_MESSAGES } from "@/lib/links";

const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const ok = { orgName: " Acme ", orgSlug: "Acme", appName: "Web app", appSlug: "web-app" };

describe("parseCompanyForm", () => {
  it("tidies the names and lowercases the slugs, ready for either RPC", () => {
    const r = parseCompanyForm(form(ok));
    expect(r).toEqual({ ok: true, value: { orgName: "Acme", orgSlug: "acme", appName: "Web app", appSlug: "web-app" } });
    if (r.ok) expect(companyRpcArgs(r.value)).toEqual({ p_org_name: "Acme", p_org_slug: "acme", p_app_name: "Web app", p_app_slug: "web-app" });
  });

  it("names the first field to fix", () => {
    expect(parseCompanyForm(form({ ...ok, orgName: "" }))).toMatchObject({ ok: false, field: "orgName" });
    expect(parseCompanyForm(form({ ...ok, appName: "x".repeat(81) }))).toMatchObject({ ok: false, field: "appName" });
    expect(parseCompanyForm(form({ ...ok, orgSlug: "admin" }))).toEqual({ ok: false, field: "orgSlug", error: SLUG_MESSAGES.slug_reserved });
    expect(parseCompanyForm(form({ ...ok, appSlug: "web app" }))).toEqual({ ok: false, field: "appSlug", error: SLUG_MESSAGES.slug_invalid });
  });
});
