import { afterAll, beforeAll, expect, it } from "vitest";
import { admin, cleanup, makeApp, makeUser, type Tenant } from "./harness";

// a and b each own a company with one app; pa and pb are those apps' ids.
let a: Tenant, b: Tenant, pa: string, pb: string;
beforeAll(async () => { a = await makeUser("a"); b = await makeUser("b"); pa = (await makeApp(a)).appId; pb = (await makeApp(b)).appId; });
afterAll(cleanup);

it("a member reads only their own project and its issues", async () => {
  expect((await a.db.from("projects").select("id")).data!.map((r) => r.id)).toEqual([pa]);
  expect((await a.db.from("issues").select("id").eq("project_id", pb)).data).toEqual([]);
  // Control: the issue is really there, so the empty result above is the policy and not a missing row.
  expect((await b.db.from("issues").select("id").eq("project_id", pb)).data).toHaveLength(1);
});

it("a member cannot update another project", async () => {
  await a.db.from("projects").update({ name: "pwned" }).eq("id", pb);
  expect((await admin().from("projects").select("name").eq("id", pb).single()).data!.name).not.toBe("pwned");
  // Control: the same update on their own project (a owns its company) does land, so the block above is the policy
  // and not a broken update.
  await a.db.from("projects").update({ name: "rls-renamed" }).eq("id", pa);
  expect((await admin().from("projects").select("name").eq("id", pa).single()).data!.name).toBe("rls-renamed");
});
