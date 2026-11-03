// Connections (supabase/migrations/0030_connections.sql, 0031_connector_signals.sql): secrets live in Vault and only the
// service role reads them; members see their own company's connection status and nothing else; the audit log is for
// owners and admins; PostHog signals are read-only for members, and links tie an issue to an error inside one app.
import { afterAll, beforeAll, expect, it } from "vitest";
import { addOrgMember, admin, cleanup, makeApp, makeUser, rpc, type App, type Tenant } from "./harness";

let a: Tenant, member: Tenant, b: Tenant, stranger: Tenant;
let A: App, B: App;
let companyConn: string, otherConn: string;

async function insertConnection(row: Record<string, unknown>): Promise<string> {
  const r = await admin().from("connections").insert(row).select("id").single();
  if (r.error) throw new Error(`insert connection: ${r.error.message}`);
  return r.data.id as string;
}

beforeAll(async () => {
  [a, member, b, stranger] = await Promise.all(["conn-a", "conn-member", "conn-b", "conn-stranger"].map((l) => makeUser(l)));
  [A, B] = await Promise.all([makeApp(a), makeApp(b)]);
  await addOrgMember(A.orgId, member, "member");
  companyConn = await insertConnection({ org_id: A.orgId, kind: "granola", status: "ok", display: { last4: "abcd" }, config: { webhook_id: "whe_1" } });
  await insertConnection({ org_id: A.orgId, project_id: A.appId, kind: "posthog", status: "broken", status_reason: "token expired", display: { project: "Web" } });
  otherConn = await insertConnection({ org_id: B.orgId, kind: "slack", status: "ok", display: { team: "B workspace" } });
  await admin().rpc("connection_secret_set", { p_connection: companyConn, p_secret: "grn_secret_value" });
  await admin().from("audit_log").insert([
    { org_id: A.orgId, project_id: A.appId, actor_id: a.userId, action: "connection.connected", target: "granola" },
    { org_id: B.orgId, actor_id: b.userId, action: "connection.connected", target: "slack" },
  ]);
}, 60_000);
afterAll(cleanup, 60_000);

it("keeps a secret in Vault: set, replace, read, drop", async () => {
  const db = admin();
  expect((await db.rpc("connection_secret_get", { p_connection: companyConn })).data).toBe("grn_secret_value");
  expect((await db.rpc("connection_secret_set", { p_connection: companyConn, p_secret: "grn_rotated" })).error).toBeNull();
  expect((await db.rpc("connection_secret_get", { p_connection: companyConn })).data).toBe("grn_rotated");
  const { data: row } = await db.from("connections").select("secret_id").eq("id", companyConn).single();
  expect(row!.secret_id).toBeTruthy();
  expect((await db.rpc("connection_secret_drop", { p_connection: companyConn })).error).toBeNull();
  expect((await db.rpc("connection_secret_get", { p_connection: companyConn })).data).toBeNull();
  expect((await db.from("connections").select("secret_id").eq("id", companyConn).single()).data!.secret_id).toBeNull();
  await db.rpc("connection_secret_set", { p_connection: companyConn, p_secret: "grn_again" });
  expect((await db.rpc("connection_secret_get", { p_connection: companyConn })).data).toBe("grn_again");
});

it("deleting a connection deletes its secret", async () => {
  const db = admin();
  const temp = await insertConnection({ org_id: A.orgId, project_id: A.appId, kind: "marver", status: "ok" });
  await db.rpc("connection_secret_set", { p_connection: temp, p_secret: "temporary" });
  const secretId = (await db.from("connections").select("secret_id").eq("id", temp).single()).data!.secret_id as string;
  await db.from("connections").delete().eq("id", temp);
  // A new row pointing at the old secret id reads nothing: the secret is gone from Vault.
  const probe = await insertConnection({ org_id: A.orgId, project_id: A.appId, kind: "marver", status: "pending", secret_id: secretId });
  expect((await db.rpc("connection_secret_get", { p_connection: probe })).data).toBeNull();
  await db.from("connections").delete().eq("id", probe);
});

it("refuses an app-level connection whose app is in another company", async () => {
  const r = await admin().from("connections").insert({ org_id: A.orgId, project_id: B.appId, kind: "posthog" });
  expect(r.error?.message).toMatch(/another company/);
});

it("keeps one row per tool per company and per app", async () => {
  const r = await admin().from("connections").insert({ org_id: A.orgId, kind: "granola" });
  expect(r.error?.code).toBe("23505");
});

it("never lets a signed-in user read secrets, connection rows, installations or OAuth states", async () => {
  for (const t of [a, member, b]) {
    expect((await t.db.rpc("connection_secret_get", { p_connection: companyConn })).error).not.toBeNull();
    expect((await t.db.rpc("connection_secret_set", { p_connection: companyConn, p_secret: "x" })).error).not.toBeNull();
    expect((await t.db.rpc("connection_secret_drop", { p_connection: companyConn })).error).not.toBeNull();
    for (const table of ["connections", "slack_installations", "oauth_states"]) {
      const { data, error } = await t.db.from(table).select("*").limit(5);
      expect(error !== null || (data ?? []).length === 0, `${table} readable`).toBe(true);
    }
  }
  // The secret survived all of that.
  expect((await admin().rpc("connection_secret_get", { p_connection: companyConn })).data).toBe("grn_again");
});

it("shows members their app's company and app connections, without config or secrets", async () => {
  for (const t of [a, member]) {
    const rows = await rpc<{ kind: string; scope: string; status: string; display: Record<string, unknown> }[]>(t, "connection_status", { p_project: A.appId });
    expect(rows.map((r) => `${r.scope}:${r.kind}:${r.status}`).sort()).toEqual(["app:posthog:broken", "company:granola:ok"]);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(["display", "kind", "scope", "status", "status_reason", "updated_at", "verified_at"]);
      expect(JSON.stringify(r)).not.toMatch(/grn_|whe_1/);
    }
  }
  // Control: B sees its own Slack, so the empty answers below are the check and not a broken function.
  expect((await rpc(b, "connection_status", { p_project: B.appId })).map((r: { kind: string }) => r.kind)).toEqual(["slack"]);
  expect(await rpc(b, "connection_status", { p_project: A.appId })).toEqual([]);
  expect(await rpc(stranger, "connection_status", { p_project: A.appId })).toEqual([]);
  expect(otherConn).toBeTruthy();
});

it("shows the audit log to the company's owners and admins only", async () => {
  const mine = await a.db.from("audit_log").select("org_id, action");
  expect(mine.data!.map((r) => r.org_id)).toEqual([A.orgId]);
  expect((await member.db.from("audit_log").select("id")).data).toEqual([]);
  expect((await stranger.db.from("audit_log").select("id")).data).toEqual([]);
  expect((await a.db.from("audit_log").insert({ org_id: A.orgId, action: "forged" })).error).not.toBeNull();
});

it("lets members read their app's PostHog signals and nobody write them", async () => {
  await admin().from("issue_signals").insert({ project_id: A.appId, kind: "rageclick", key: "/checkout", users_30d: 12, events_30d: 40 });
  expect((await member.db.from("issue_signals").select("key, users_30d")).data).toEqual([{ key: "/checkout", users_30d: 12 }]);
  expect((await b.db.from("issue_signals").select("key").eq("project_id", A.appId)).data).toEqual([]);
  expect((await a.db.from("issue_signals").insert({ project_id: A.appId, kind: "pageview", key: "/x" })).error).not.toBeNull();
});

it("lets members link a PostHog error to their own app's issue, and nowhere else", async () => {
  const link = { provider: "posthog", kind: "error", external_id: "err-1", title: "TypeError: x is undefined" };
  const ok = await member.db.from("issue_links").insert({ ...link, project_id: A.appId, issue_id: A.issueId, created_by: member.userId }).select("id").single();
  expect(ok.error).toBeNull();
  // Another app's issue under this app's id, another company's app, or someone else's name: all refused.
  expect((await a.db.from("issue_links").insert({ ...link, external_id: "err-2", project_id: A.appId, issue_id: B.issueId, created_by: a.userId })).error).not.toBeNull();
  expect((await a.db.from("issue_links").insert({ ...link, external_id: "err-3", project_id: B.appId, issue_id: B.issueId, created_by: a.userId })).error).not.toBeNull();
  expect((await a.db.from("issue_links").insert({ ...link, external_id: "err-4", project_id: A.appId, issue_id: A.issueId, created_by: member.userId })).error).not.toBeNull();
  expect((await b.db.from("issue_links").select("id").eq("project_id", A.appId)).data).toEqual([]);
  // B can't unlink A's link; A's member can.
  await b.db.from("issue_links").delete().eq("id", ok.data!.id);
  expect((await admin().from("issue_links").select("id").eq("id", ok.data!.id)).data).toHaveLength(1);
  await member.db.from("issue_links").delete().eq("id", ok.data!.id);
  expect((await admin().from("issue_links").select("id").eq("id", ok.data!.id)).data).toHaveLength(0);
});
