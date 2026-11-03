// Finding an app from /[org]/[app] (src/lib/db/app.ts): the lookup runs as the signed-in user through RLS, so it finds an
// app for the members of the company that owns it and for nobody else, and it reports the caller's role.
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  appById, appForIssue, appForSource, hasRole, lastAppHref, LAST_APP_COOKIE, myApps, requireApp, requireUser, resolveApp,
} from "@/lib/db/app";
import { addOrgMember, admin, cleanup, makeApp, makeUser, type App, type Tenant } from "./harness";

// The request-scoped functions read the session from cookies. Here "the request" is whichever tenant `as()` last picked,
// and the cookie jar is `jar`; React's cache is a pass-through outside a server render, so each call looks up afresh.
const req = vi.hoisted(() => ({ db: null as unknown, jar: {} as Record<string, string> }));
vi.mock("@/lib/db/server", () => ({ userDb: async () => req.db }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name in req.jar ? { name, value: req.jar[name] } : undefined) }),
}));
const as = (t: Tenant, jar: Record<string, string> = {}) => { req.db = t.db; req.jar = jar; };

// a owns company A; admin and member belong to it with those roles; b owns company B; stranger belongs to no company.
let a: Tenant, adminUser: Tenant, member: Tenant, b: Tenant, stranger: Tenant;
let A: App, B: App, second: App; // second: a company where `member` is also just a member, so they can open two apps

beforeAll(async () => {
  [a, adminUser, member, b, stranger] = await Promise.all(["a", "admin", "member", "b", "stranger"].map((label) => makeUser(label)));
  [A, B] = await Promise.all([makeApp(a), makeApp(b)]);
  await addOrgMember(A.orgId, adminUser, "admin");
  await addOrgMember(A.orgId, member, "member");
  second = await makeApp(member, "member");
}, 60_000);
afterAll(cleanup, 60_000);

it("resolves an app for its members and nobody else", async () => {
  expect((await resolveApp(a.db, A.orgSlug, A.appSlug))!.base).toBe(`/${A.orgSlug}/${A.appSlug}`);
  expect(await resolveApp(b.db, A.orgSlug, A.appSlug)).toBeNull();
  expect(await resolveApp(stranger.db, A.orgSlug, A.appSlug)).toBeNull();
  expect(await resolveApp(a.db, A.orgSlug, "nope")).toBeNull();
  expect(await resolveApp(a.db, "nope", A.appSlug)).toBeNull();
  // The slugs are a pair: company A's app slug under company B's slug is nothing, even for a member of both.
  expect(await resolveApp(b.db, B.orgSlug, A.appSlug)).toBeNull();
  // Control: B's own owner does find B's app, so the nulls above are the policies and not a broken query.
  expect((await resolveApp(b.db, B.orgSlug, B.appSlug))!.project.id).toBe(B.appId);
});

it("returns the caller's role", async () => {
  expect((await resolveApp(a.db, A.orgSlug, A.appSlug))!.role).toBe("owner");
  expect((await resolveApp(adminUser.db, A.orgSlug, A.appSlug))!.role).toBe("admin");
  expect((await resolveApp(member.db, A.orgSlug, A.appSlug))!.role).toBe("member");
});

it("returns the company and the app, with the app's company and slug on the project", async () => {
  const ctx = (await resolveApp(a.db, A.orgSlug, A.appSlug))!;
  expect(ctx.org).toEqual({ id: A.orgId, name: A.orgSlug, slug: A.orgSlug });
  expect(ctx.project).toMatchObject({ id: A.appId, org_id: A.orgId, slug: A.appSlug, kind: "customer" });
  expect(ctx.project).not.toHaveProperty("organizations");
});

it("matches slugs without regard to case and builds the base from the stored slugs", async () => {
  expect((await resolveApp(a.db, A.orgSlug.toUpperCase(), A.appSlug.toUpperCase()))!.base).toBe(`/${A.orgSlug}/${A.appSlug}`);
});

it("ignores a company that has been deleted", async () => {
  const gone = await admin().from("organizations").update({ deleted_at: new Date().toISOString() }).eq("id", B.orgId);
  expect(gone.error).toBeNull();
  expect(await resolveApp(b.db, B.orgSlug, B.appSlug)).toBeNull();
  // Company A is untouched.
  expect(await resolveApp(a.db, A.orgSlug, A.appSlug)).not.toBeNull();
  // The id lookups and the app list skip the deleted company too.
  as(b);
  expect(await appById(B.appId)).toBeNull();
  expect(await myApps()).toEqual([]);
});

// -- The request-scoped lookups ---------------------------------------------------------------------------------------

it("requireApp returns the signed-in user with the app, and is a 404 for a non-member", async () => {
  as(adminUser);
  const ctx = await requireApp(A.orgSlug, A.appSlug);
  expect(ctx).toMatchObject({ userId: adminUser.userId, email: adminUser.email, role: "admin", base: `/${A.orgSlug}/${A.appSlug}` });
  expect(ctx.project.id).toBe(A.appId);
  as(stranger);
  await expect(requireApp(A.orgSlug, A.appSlug)).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  as(a);
  await expect(requireApp(A.orgSlug, "nope")).rejects.toMatchObject({ digest: expect.stringContaining("404") });
});

it("requireUser redirects to sign-in when nobody is signed in", async () => {
  as(a);
  expect(await requireUser()).toEqual({ userId: a.userId, email: a.email });
  req.db = (await import("@supabase/supabase-js")).createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  await expect(requireUser()).rejects.toMatchObject({ digest: expect.stringContaining("/sign-in") });
  expect(await appById(A.appId)).toBeNull();
  expect(await myApps()).toEqual([]);
});

it("appById, appForIssue and appForSource find the app only for the company's members", async () => {
  const src = await admin().from("sources")
    .insert({ project_id: A.appId, kind: "paste", raw_text: "rls source", content_hash: `rls-${A.appId}` }).select("id").single();
  expect(src.error).toBeNull();

  as(member);
  expect((await appById(A.appId))!.role).toBe("member");
  expect((await appForIssue(A.issueId))!.project.id).toBe(A.appId);
  expect((await appForSource(src.data!.id))!.project.id).toBe(A.appId);

  as(b);
  expect(await appById(A.appId)).toBeNull();
  expect(await appForIssue(A.issueId)).toBeNull();
  expect(await appForSource(src.data!.id)).toBeNull();

  // Ids that are not ids, and ids that match nothing, are null rather than an error.
  as(a);
  for (const bad of ["nope", "", "00000000-0000-0000-0000-000000000000"]) {
    expect(await appById(bad)).toBeNull();
    expect(await appForIssue(bad)).toBeNull();
    expect(await appForSource(bad)).toBeNull();
  }
});

it("myApps lists the user's apps with their roles, ordered, and nobody else's", async () => {
  as(member);
  const mine = await myApps();
  expect(mine.map((m) => m.app.id).sort()).toEqual([A.appId, second.appId].sort());
  expect(mine.find((m) => m.app.id === A.appId)).toEqual({
    org: { id: A.orgId, name: A.orgSlug, slug: A.orgSlug }, app: { id: A.appId, slug: A.appSlug, name: `rls-${A.appSlug}` }, role: "member",
  });
  expect(mine.find((m) => m.app.id === second.appId)!.role).toBe("member");
  expect(mine.map((m) => m.org.slug)).toEqual([...mine.map((m) => m.org.slug)].sort());
  as(stranger);
  expect(await myApps()).toEqual([]);
});

it("lastAppHref prefers the cookie, ignores one the user cannot open, and is null with no apps", async () => {
  // `member` can open two apps (A's and second's); the list is ordered.
  as(member);
  const [first, next] = (await myApps()).map((m) => `${m.org.slug}/${m.app.slug}`);
  expect(next).toBeDefined();
  as(member, { [LAST_APP_COOKIE]: next });
  expect(await lastAppHref()).toBe(`/${next}`);
  as(member, { [LAST_APP_COOKIE]: first });
  expect(await lastAppHref()).toBe(`/${first}`);
  // No cookie, a cookie for an app in someone else's company, and a cookie that is not an app: the first app.
  for (const jar of [{} as Record<string, string>, { [LAST_APP_COOKIE]: `${B.orgSlug}/${B.appSlug}` }, { [LAST_APP_COOKIE]: "garbage" }, { [LAST_APP_COOKIE]: "" }]) {
    as(member, jar);
    expect(await lastAppHref()).toBe(`/${first}`);
  }
  as(stranger, { [LAST_APP_COOKIE]: `${A.orgSlug}/${A.appSlug}` });
  expect(await lastAppHref()).toBeNull();
});

it("hasRole checks the caller's role against the list", async () => {
  as(member);
  const ctx = await requireApp(A.orgSlug, A.appSlug);
  expect(hasRole(ctx, ["member"])).toBe(true);
  expect(hasRole(ctx, ["owner", "admin"])).toBe(false);
  expect(hasRole(ctx, [])).toBe(false);
});
