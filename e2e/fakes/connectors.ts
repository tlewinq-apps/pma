// A local stand-in for Slack, PostHog, Granola, Anthropic and GitHub, so the connector flows run end to end on a dev
// server without any real account. The dev server is pointed at it with SLACK_API_URL, POSTHOG_API_URL, GRANOLA_API_URL,
// ANTHROPIC_BASE_URL, GITHUB_API_URL and GITHUB_WEB_URL (see e2e/connectors.spec.ts). It answers like each API does for
// the calls PMA makes, and records every call with the credential it carried, so a test can check which company's
// token was used. Run on its own, it also writes e2e/.github-app.env: a throwaway GitHub App key the dev server signs its
// JWT with (GitHub's side here doesn't check the signature; PMA still has to make one).
import { createServer, type IncomingMessage, type Server } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

export const FAKE = {
  slack: { token: "xoxb-e2e-fake", team: "TE2EFAKE", teamName: "E2E Workspace", bot: "UE2EBOT", url: "https://e2e-fake.slack.com/" },
  posthog: { projectId: 4242, project: "E2E Web", errorId: "0190e2e0-0000-7000-8000-000000000001" },
  granola: { noteId: "not_e2eFakeNote0001", webhookId: "whe_e2e_fake", secret: `whsec_${Buffer.from("e2e-granola-signing-secret-000001").toString("base64")}` },
  github: { slug: "pma-e2e", installation: 4242001, account: "e2e-org", userToken: "ghu_e2e_fake", installToken: "ghs_e2e_fake", repo: "e2e-org/private-app", base: "e2ebase0000000000000000000000000000000001", pr: 7, webhookSecret: "e2e-github-webhook" },
  /** Build it's scripted Claude: read the file, write the change, finish. */
  build: { path: "src/checkout.tsx", content: "export function Checkout() { return <button type=\"submit\">Pay now</button>; }\n", title: "Make the pay button submit" },
};

/** A tiny ustar tar.gz of the private repo, as GitHub's tarball endpoint serves it ("<owner>-<repo>-<sha>/…"). */
function privateTarball(): Buffer {
  const entry = (name: string, body: string) => {
    const h = Buffer.alloc(512);
    h.write(name, 0, 100, "utf8"); h.write("0000644\0", 100); h.write("0000000\0", 108); h.write("0000000\0", 116);
    h.write(`${Buffer.byteLength(body).toString(8).padStart(11, "0")}\0`, 124); h.write("00000000000\0", 136);
    h.write("        ", 148); h.write("0", 156); h.write("ustar\0", 257); h.write("00", 263);
    let sum = 0; for (const b of h) sum += b;
    h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    const data = Buffer.from(body);
    return Buffer.concat([h, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
  };
  const top = "e2e-org-private-app-abc1234";
  return gzipSync(Buffer.concat([
    entry(`${top}/package.json`, '{ "name": "private-app" }\n'),
    entry(`${top}/src/checkout.tsx`, "export function Checkout() { return <button>Pay</button>; }\n"),
    Buffer.alloc(1024),
  ]));
}

/** GitHub's API and web endpoints PMA calls, each only with the credential GitHub would want. */
function github(web: boolean, method: string, path: string, auth: string | null, body: unknown): [number, unknown] | Buffer {
  const g = FAKE.github;
  if (web) {
    if (method === "POST" && path === "/login/oauth/access_token") {
      return (body as { code?: string })?.code === "bad" ? [200, { error: "bad_verification_code" }] : [200, { access_token: g.userToken, token_type: "bearer", scope: "" }];
    }
    return [404, { message: "Not Found" }];
  }
  if (method === "GET" && path.startsWith("/user/installations")) {
    return auth === `Bearer ${g.userToken}` ? [200, { total_count: 1, installations: [{ id: g.installation, account: { login: g.account, type: "Organization" }, repository_selection: "selected", permissions: { contents: "write", pull_requests: "write", metadata: "read" } }] }] : [401, { message: "Bad credentials" }];
  }
  if (method === "POST" && path === `/app/installations/${g.installation}/access_tokens`) {
    // An app JWT: three base64url parts. The fake can't check the signature without the public key, but it checks the shape.
    return /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(auth ?? "") ? [201, { token: g.installToken, expires_at: new Date(Date.now() + 3_600_000).toISOString(), permissions: { contents: "write", pull_requests: "write", metadata: "read" } }] : [401, { message: "A JSON web token could not be decoded" }];
  }
  const asInstallation = auth === `Bearer ${g.installToken}`;
  if (method === "GET" && path.startsWith("/installation/repositories")) {
    return asInstallation ? [200, { total_count: 1, repositories: [{ full_name: g.repo, private: true, default_branch: "main" }] }] : [401, { message: "Bad credentials" }];
  }
  if (method === "GET" && path === `/repos/${g.repo}`) return asInstallation ? [200, { full_name: g.repo, private: true, default_branch: "main" }] : [404, { message: "Not Found" }];
  if (method === "GET" && (path === `/repos/${g.repo}/tarball/main` || path === `/repos/${g.repo}/tarball/${g.base}`)) return asInstallation ? privateTarball() : [404, { message: "Not Found" }];
  // Build it's writes: the base ref, its commit and tree, then a new tree, commit, branch and pull request.
  if (!asInstallation && path.startsWith(`/repos/${g.repo}/`)) return [404, { message: "Not Found" }];
  if (method === "GET" && path === `/repos/${g.repo}/git/ref/heads/main`) return [200, { ref: "refs/heads/main", object: { sha: g.base, type: "commit" } }];
  if (method === "GET" && path === `/repos/${g.repo}/git/commits/${g.base}`) return [200, { sha: g.base, tree: { sha: "e2etree0base" } }];
  if (method === "GET" && path.startsWith(`/repos/${g.repo}/git/trees/e2etree0base`)) return [200, { sha: "e2etree0base", truncated: false, tree: [{ path: "package.json", mode: "100644", type: "blob" }, { path: "src", mode: "040000", type: "tree" }, { path: "src/checkout.tsx", mode: "100644", type: "blob" }] }];
  if (method === "POST" && path === `/repos/${g.repo}/git/trees`) return [201, { sha: "e2etree0new" }];
  if (method === "POST" && path === `/repos/${g.repo}/git/commits`) return [201, { sha: "e2ecommit0new" }];
  if (method === "POST" && path === `/repos/${g.repo}/git/refs`) return [201, { ref: (body as { ref?: string })?.ref, object: { sha: "e2ecommit0new" } }];
  if (method === "POST" && path === `/repos/${g.repo}/pulls`) return [201, { number: g.pr, html_url: `https://github.com/${g.repo}/pull/${g.pr}` }];
  return [404, { message: "Not Found" }];
}

export type FakeCall = { service: string; method: string; path: string; auth: string | null; body: unknown };

const note = {
  id: FAKE.granola.noteId, object: "note", title: "E2E customer call", owner: { name: "Priya PM", email: "priya@e2e.test" },
  attendees: [{ name: "Sam Shopper", email: "sam@e2e.test" }], created_at: "2026-10-16T09:00:00Z", web_url: "https://notes.granola.ai/d/e2e",
  summary_markdown: "Sam couldn't pay.", calendar_event: { event_title: "Customer call", scheduled_start_time: "2026-10-16T08:30:00Z" },
  transcript: [{ speaker: { source: "microphone" }, text: "How did checkout go?" }, { speaker: { source: "speaker", diarization_label: "B" }, text: "The pay button did nothing on my phone." }],
};

async function bodyOf(req: IncomingMessage): Promise<{ raw: string; parsed: unknown }> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return { raw, parsed: null };
  if ((req.headers["content-type"] ?? "").includes("application/json")) {
    try { return { raw, parsed: JSON.parse(raw) }; } catch { return { raw, parsed: raw }; }
  }
  return { raw, parsed: Object.fromEntries(new URLSearchParams(raw)) };
}

function slack(method: string, args: Record<string, string>): Record<string, unknown> {
  const channelId = (name: string) => `C${Buffer.from(name).toString("hex").slice(0, 10).toUpperCase()}`;
  switch (method) {
    case "oauth.v2.access":
      return args.code === "bad" ? { ok: false, error: "invalid_code" } : {
        ok: true, access_token: FAKE.slack.token, token_type: "bot", scope: "chat:write,commands", bot_user_id: FAKE.slack.bot, app_id: "AE2E",
        team: { id: FAKE.slack.team, name: FAKE.slack.teamName }, enterprise: null, is_enterprise_install: false,
      };
    case "auth.test": return { ok: true, url: FAKE.slack.url, team: FAKE.slack.teamName, user: "pma", team_id: FAKE.slack.team, user_id: FAKE.slack.bot };
    case "conversations.create": return { ok: true, channel: { id: channelId(args.name), name: args.name } };
    case "conversations.info": return { ok: true, channel: { id: args.channel, name: `name-${args.channel.toLowerCase()}`, is_member: true, is_private: false } };
    case "conversations.list": return { ok: true, channels: [{ id: "CE2EPICK01", name: "product-feedback", is_member: true }, { id: "CE2EPICK02", name: "product-issues", is_member: true }], response_metadata: { next_cursor: "" } };
    case "chat.postMessage": return { ok: true, ts: `${Math.floor(Date.now() / 1000)}.${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}` };
    case "users.lookupByEmail": return { ok: false, error: "users_not_found" };
    case "users.info": return { ok: true, user: { id: args.user, name: "sam", profile: { email: "sam@e2e.test", display_name: "Sam" } } };
    default: return { ok: true };
  }
}

function posthog(method: string, path: string, body: unknown): [number, unknown] {
  const id = FAKE.posthog.projectId;
  if (method === "GET" && path === "/api/projects/") return [200, { results: [{ id, name: FAKE.posthog.project }] }];
  if (method === "GET" && path === `/api/projects/${id}/`) return [200, { id, name: FAKE.posthog.project }];
  if (method === "POST" && path === `/api/projects/${id}/query/`) {
    const q = String((body as { query?: { query?: string } })?.query?.query ?? "");
    const now = new Date().toISOString();
    if (q === "select 1") return [200, { columns: ["1"], results: [[1]] }];
    if (q.includes("'$pageview'")) return [200, { results: [["/checkout", 120, 400, now]] }];
    if (q.includes("'$rageclick'")) return [200, { results: [["/checkout/pay", 9, 31, now]] }];
    if (q.includes("any(properties.$exception_types)")) return [200, { results: [[FAKE.posthog.errorId, '["TypeError"]', '["Cannot read total of undefined in Checkout"]', 14, 22, now]] }];
    if (q.includes("'$exception'")) return [200, { results: [[FAKE.posthog.errorId, 14, 22, now]] }];
    return [200, { results: [] }];
  }
  return [404, { detail: "Not found" }];
}

function granola(method: string, path: string): [number, unknown] {
  if (method === "GET" && path === "/v1/notes") return [200, { notes: [{ id: note.id, object: "note", title: note.title, created_at: note.created_at }], hasMore: false, cursor: null }];
  if (method === "GET" && path === `/v1/notes/${note.id}`) return [200, note];
  if (method === "POST" && path === "/v1/webhook-endpoints") return [200, { id: FAKE.granola.webhookId, object: "webhook_endpoint", signing_secret: FAKE.granola.secret }];
  if (method === "DELETE" && path.startsWith("/v1/webhook-endpoints/")) return [200, { id: FAKE.granola.webhookId, deleted: true }];
  return [404, { message: "not found" }];
}

function anthropic(method: string, path: string, body: unknown): [number, unknown] {
  if (method === "GET" && path === "/v1/models") return [200, { data: [{ id: "claude-haiku-5-5", type: "model", display_name: "Claude Haiku 5.5", created_at: "2026-01-01T00:00:00Z" }], has_more: false, first_id: "claude-haiku-5-5", last_id: "claude-haiku-5-5" }];
  if (method === "POST" && path === "/v1/messages") {
    const model = (body as { model?: string })?.model ?? "claude-haiku-5-5";
    const b = body as { tools?: unknown[]; messages?: { role: string }[] };
    if (Array.isArray(b?.tools) && b.tools.length) {
      // Build it: one tool call per turn, by how many turns came before.
      const turn = (b.messages ?? []).filter((m) => m.role === "assistant").length;
      const toolCall = (name: string, input: Record<string, unknown>) => [200, { id: `msg_e2e_build_${turn}`, type: "message", role: "assistant", model, content: [{ type: "tool_use", id: `toolu_e2e_${turn}`, name, input }], stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }] as [number, unknown];
      if (turn === 0) return toolCall("read_file", { path: FAKE.build.path });
      if (turn === 1) return toolCall("write_file", { path: FAKE.build.path, content: FAKE.build.content });
      return toolCall("finish", { title: FAKE.build.title, summary: "The pay button now submits the checkout form." });
    }
    return [200, { id: "msg_e2e", type: "message", role: "assistant", model, content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }];
  }
  return [404, { type: "error", error: { type: "not_found_error", message: "not found" } }];
}

export async function startFakeConnectors(port: number): Promise<{ calls: FakeCall[]; close: () => Promise<void>; server: Server }> {
  const calls: FakeCall[] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const { parsed } = await bodyOf(req);
    const auth = (req.headers.authorization as string | undefined) ?? (req.headers["x-api-key"] ? `x-api-key ${req.headers["x-api-key"]}` : null);
    const send = (status: number, payload: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); };
    // The test reads what was called (and from a clean slate) over HTTP: the fake may run in its own process.
    if (url.pathname === "/_calls") return send(200, calls);
    if (url.pathname === "/_reset") { calls.length = 0; return send(200, { ok: true }); }
    const [, service, ...rest] = url.pathname.split("/");
    const path = `/${rest.join("/")}`.replace(/^\/api(?=\/[a-z.]+$)/, ""); // /slack/api/<method>
    calls.push({ service, method: req.method ?? "GET", path: path + url.search, auth, body: parsed });
    if (service === "slack") return send(200, slack(path.replace(/^\/(api\/)?/, ""), (parsed ?? {}) as Record<string, string>));
    if (service === "posthog") return send(...posthog(req.method ?? "GET", url.pathname.slice("/posthog".length), parsed));
    if (service === "granola") return send(...granola(req.method ?? "GET", url.pathname.slice("/granola".length)));
    if (service === "anthropic") return send(...anthropic(req.method ?? "GET", url.pathname.slice("/anthropic".length), parsed));
    if (service === "github" || service === "githubweb") {
      const r = github(service === "githubweb", req.method ?? "GET", url.pathname.slice(service.length + 1) + url.search, auth, parsed);
      if (Buffer.isBuffer(r)) { res.writeHead(200, { "content-type": "application/x-gzip" }); return res.end(r); }
      return send(...r);
    }
    send(404, { error: "unknown fake service" });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return { calls, server, close: () => new Promise((r) => server.close(() => r())) };
}

// Run on its own (npm run e2e:fakes) so a dev server started before Playwright can reach it.
if (process.argv[1]?.endsWith("connectors.ts")) {
  const port = Number(process.env.FAKE_CONNECTORS_PORT ?? 4787);
  const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  writeFileSync("e2e/.github-app.env", [
    `GITHUB_APP_ID=999001`, `GITHUB_APP_SLUG=${FAKE.github.slug}`, `GITHUB_APP_CLIENT_ID=Iv1.e2e`, `GITHUB_APP_CLIENT_SECRET=e2e-github-secret`,
    `GITHUB_APP_WEBHOOK_SECRET=${FAKE.github.webhookSecret}`, `GITHUB_APP_PRIVATE_KEY="${pem.trim().replace(/\n/g, "\\n")}"`, "",
  ].join("\n"));
  void startFakeConnectors(port).then(() => console.log(`Fake Slack, PostHog, Granola, Anthropic and GitHub on http://localhost:${port} (GitHub App key in e2e/.github-app.env)`));
}
