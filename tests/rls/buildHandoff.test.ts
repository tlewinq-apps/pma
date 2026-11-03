// Migration 0040 on the dev database: linked pull requests are read through the issue's app (is_member), never across
// companies, and nobody signed in writes them or projects.settings directly: those writes go through role-checked
// routes with the service role.
import { afterAll, beforeAll, expect, it } from "vitest";
import { addOrgMember, admin, cleanup, makeApp, makeUser, type App, type Tenant } from "./harness";

let a: Tenant, member: Tenant, b: Tenant, A: App, B: App, linkA: string;
beforeAll(async () => {
  [a, member, b] = await Promise.all([makeUser("pr-owner"), makeUser("pr-member"), makeUser("pr-other")]);
  [A, B] = await Promise.all([makeApp(a), makeApp(b)]);
  await addOrgMember(A.orgId, member, "member");
  for (const [app, n] of [[A, 1], [B, 2]] as const) {
    const r = await admin().from("pull_request_links")
      .insert({ issue_id: app.issueId, url: `https://github.com/rls-acme/web-app/pull/${n}`, repo: "rls-acme/web-app", number: n })
      .select("id").single();
    if (r.error) throw new Error(`insert pull_request_link: ${r.error.message}`);
    if (app === A) linkA = r.data.id as string;
  }
}, 60_000);
afterAll(cleanup, 60_000); // deleting the issues removes their links

it("everyone in the company reads the issue's pull requests; another company sees none", async () => {
  expect((await a.db.from("pull_request_links").select("id, number")).data).toEqual([{ id: linkA, number: 1 }]);
  expect((await member.db.from("pull_request_links").select("number")).data).toEqual([{ number: 1 }]);
  expect((await b.db.from("pull_request_links").select("number").eq("issue_id", A.issueId)).data).toEqual([]);
  // Control: B reads its own, so the empty answer above is the policy.
  expect((await b.db.from("pull_request_links").select("number")).data).toEqual([{ number: 2 }]);
});

it("the issue page's embed carries only the company's own links", async () => {
  const { data } = await a.db.from("issues").select("id, pull_request_links(number)").eq("id", A.issueId).single();
  expect(data!.pull_request_links).toEqual([{ number: 1 }]);
});

it("nobody signed in links, edits or removes a pull request directly, not even an owner", async () => {
  const ins = await a.db.from("pull_request_links").insert({ issue_id: A.issueId, url: "https://github.com/rls-acme/web-app/pull/9", repo: "rls-acme/web-app", number: 9 });
  expect(ins.error).not.toBeNull();
  await a.db.from("pull_request_links").update({ preview_url: "https://evil.example" }).eq("id", linkA);
  await b.db.from("pull_request_links").delete().eq("id", linkA);
  await a.db.from("pull_request_links").delete().eq("id", linkA);
  const { data } = await admin().from("pull_request_links").select("number, preview_url").eq("issue_id", A.issueId);
  expect(data).toEqual([{ number: 1, preview_url: null }]);
});

it("the database refuses a link that isn't a GitHub pull request, and the same pull request twice", async () => {
  const bad = await admin().from("pull_request_links").insert({ issue_id: A.issueId, url: "https://evil.example/acme/web-app/pull/3", repo: "rls-acme/web-app", number: 3 });
  expect(bad.error?.message).toMatch(/check constraint/);
  const preview = await admin().from("pull_request_links").insert({ issue_id: A.issueId, url: "https://github.com/rls-acme/web-app/pull/4", repo: "rls-acme/web-app", number: 4, preview_url: "javascript:alert(1)" });
  expect(preview.error?.message).toMatch(/check constraint/);
  const twice = await admin().from("pull_request_links").insert({ issue_id: A.issueId, url: "https://github.com/RLS-ACME/web-app/pull/1", repo: "RLS-ACME/web-app", number: 1 });
  expect(twice.error?.code).toBe("23505");
});

it("an owner can't write projects.settings directly; the server does it after the role check", async () => {
  await a.db.from("projects").update({ settings: { build: { mode: "new_pr" } } }).eq("id", A.appId);
  expect((await admin().from("projects").select("settings").eq("id", A.appId).single()).data!.settings).toEqual({});
  // Members can read it (the issue page shows the default).
  expect((await member.db.from("projects").select("settings").eq("id", A.appId).single()).data!.settings).toEqual({});
});
