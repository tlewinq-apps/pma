// Build it (lib/build): what may be written, Claude's tools over the snapshot, the resumable loop, the GitHub writes,
// the pull request description, where an issue stands while it's built, and what a pull request event does to issues.
// Claude, GitHub and the database are faked; nothing is called.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/server", () => ({ serviceDb: () => { throw new Error("pass a db"); } }));
vi.mock("@/lib/slack/reporters", () => ({ tellReporters: vi.fn(async () => {}) }));

import { pathProblem, writeProblem, MAX_FILES } from "@/lib/build/guards";
import { BuildError, BUILD_TOOLS, MAX_TURNS, runBuildAgent, runTool, TURN_BUDGET_MS, type AgentState } from "@/lib/build/agent";
import { commitStaged, fastForward, pullRequestBody, pushNewBranch, quietMentions, type Gh } from "@/lib/build/commit";
import { pmaMarker, onPullRequest } from "@/lib/build/pullEvents";
import { GithubAppError } from "@/lib/github/app";
import { buildProgress, type BuildView } from "@/lib/handoff/build";
import type { RepoSnapshot } from "@/lib/repo/snapshot";
import type { ToolReply } from "@/lib/llm/client";

const snap = (files: Record<string, string>): RepoSnapshot => ({
  repo: "acme/web", ref: "abc", source: "github",
  files: () => Object.keys(files).sort().map((path) => ({ path, size: files[path].length })),
  read: (p) => files[p] ?? null,
});

describe("what Build it may write", () => {
  it("refuses workflows, lockfiles, env files, keys and paths outside the repository", () => {
    for (const p of [".github/workflows/ci.yml", "package-lock.json", "web/pnpm-lock.yaml", ".env", "apps/.env.local", "certs/server.pem", "/etc/passwd", "../x.ts", "a//b.ts", "src/./a.ts", ".git/config", "node_modules/x/index.js"]) {
      expect(pathProblem(p), p).not.toBeNull();
    }
    for (const p of ["src/app/page.tsx", "README.md", "packages/ui/src/Button.tsx", "app/(tabs)/index.tsx"]) expect(pathProblem(p), p).toBeNull();
  });

  it("caps the files, their size and the total", () => {
    const staged = new Map(Array.from({ length: MAX_FILES }, (_, k) => [`f${k}.ts`, "x"]));
    expect(writeProblem("new.ts", "x", staged)).toMatch(/at most 20 files/);
    expect(writeProblem("f1.ts", "y", staged)).toBeNull(); // replacing a staged file is fine
    expect(writeProblem("big.ts", "x".repeat(400_001), new Map())).toMatch(/KB/);
    expect(writeProblem("bin.ts", "a\u0000b", new Map())).toMatch(/text/);
  });
});

describe("Claude's tools over the snapshot", () => {
  const s = snap({ "src/a.ts": "export const a = 1;\nexport const b = 2;\n", "src/b.tsx": "<Button onClick={pay}>Pay</Button>\n" });

  it("lists, reads with line numbers, and searches; a staged file reads as staged", () => {
    const staged = new Map<string, string>();
    expect(runTool("list_files", { prefix: "src/" }, s, staged).text).toBe("src/a.ts\nsrc/b.tsx");
    expect(runTool("read_file", { path: "src/a.ts", from: 2 }, s, staged).text).toContain("2\texport const b = 2;");
    expect(runTool("read_file", { path: "nope.ts" }, s, staged).error).toBe(true);
    expect(runTool("search", { pattern: "button" }, s, staged).text).toBe("src/b.tsx:1: <Button onClick={pay}>Pay</Button>");
    expect(runTool("search", { pattern: "(" }, s, staged).error).toBe(true);
    const w = runTool("write_file", { path: "src/a.ts", content: "export const a = 2;\n" }, s, staged);
    expect(w.step).toBe("Changing src/a.ts");
    expect(runTool("read_file", { path: "src/a.ts" }, s, staged).text).toContain("1\texport const a = 2;");
    expect(runTool("write_file", { path: ".github/x.yml", content: "x" }, s, staged).error).toBe(true);
    expect(runTool("write_file", { path: "src/new.ts", content: "x" }, s, staged).step).toBe("Adding src/new.ts");
  });

  it("edit_file replaces one exact, unique snippet (or all with replace_all), on top of earlier edits", () => {
    const staged = new Map<string, string>();
    const big = snap({ "src/v.tsx": "const a = 1;\nconst h = 300;\nconst h2 = 300;\n" });
    expect(runTool("edit_file", { path: "src/v.tsx", old_string: "const a = 1;", new_string: "const a = 2;" }, big, staged).step).toBe("Changing src/v.tsx");
    expect(staged.get("src/v.tsx")).toBe("const a = 2;\nconst h = 300;\nconst h2 = 300;\n");
    expect(runTool("edit_file", { path: "src/v.tsx", old_string: "300", new_string: "'90vh'" }, big, staged).text).toMatch(/appears 2 times/);
    expect(runTool("edit_file", { path: "src/v.tsx", old_string: "300", new_string: "$&$1", replace_all: true }, big, staged).text).toBe("Edited src/v.tsx (2 places).");
    expect(staged.get("src/v.tsx")).toBe("const a = 2;\nconst h = $&$1;\nconst h2 = $&$1;\n"); // replacement text is literal
    expect(runTool("edit_file", { path: "src/v.tsx", old_string: "nope", new_string: "x" }, big, staged).error).toBe(true);
    expect(runTool("edit_file", { path: "src/missing.tsx", old_string: "a", new_string: "b" }, big, staged).error).toBe(true);
  });

  it("finish needs a title, a summary and something staged", () => {
    expect(runTool("finish", { title: "Fix pay", summary: "" }, s, new Map()).error).toBe(true);
    const empty = runTool("finish", { title: "Fix pay", summary: "Can't: the code isn't here." }, s, new Map());
    expect(empty.error).toBe(true);
    expect(empty.finish?.summary).toMatch(/Can't/);
    const ok = runTool("finish", { title: "Fix pay", summary: "Wires the button." }, s, new Map([["src/a.ts", "x"]]));
    expect(ok.error).toBeUndefined();
    expect(ok.finish).toEqual({ title: "Fix pay", summary: "Wires the button." });
    expect(BUILD_TOOLS.map((t) => t.name)).toEqual(["list_files", "read_file", "search", "edit_file", "write_file", "finish"]);
  });
});

/** A fake Claude that answers each turn from a script of tool calls. */
function scripted(turns: { name: string; input: Record<string, unknown> }[][]) {
  let k = 0;
  const call = vi.fn(async () => {
    const uses = turns[Math.min(k++, turns.length - 1)];
    return { stop_reason: uses.length ? "tool_use" : "end_turn", content: uses.map((u, i) => ({ type: "tool_use", id: `t${k}-${i}`, name: u.name, input: u.input })) } as unknown as ToolReply;
  });
  return call;
}
const fresh = (): AgentState => ({ transcript: [], staged: {}, turns: 0 });

describe("the build loop", () => {
  const s = snap({ "src/a.ts": "export const a = 1;\n" });

  it("reads, stages, finishes, and saves after every turn", async () => {
    const call = scripted([[{ name: "read_file", input: { path: "src/a.ts" } }], [{ name: "write_file", input: { path: "src/a.ts", content: "export const a = 2;\n" } }], [{ name: "finish", input: { title: "Set a to 2", summary: "Changes a." } }]]);
    const saves: string[][] = [];
    const out = await runBuildAgent({ brief: "Build it", snapshot: s, state: fresh(), deadline: Date.now() + 600_000, call, save: async (_st, steps) => { saves.push(steps); } });
    expect(out.status).toBe("finished");
    if (out.status !== "finished") return;
    expect(out.title).toBe("Set a to 2");
    expect(out.state.staged).toEqual({ "src/a.ts": "export const a = 2;\n" });
    expect(out.state.turns).toBe(3);
    expect(saves).toEqual([["Reading src/a.ts"], ["Changing src/a.ts"], ["Finished: Set a to 2"]]);
    // Every tool use got its result in the next user turn.
    expect(out.state.transcript.map((m) => m.role)).toEqual(["assistant", "user", "assistant", "user", "assistant", "user"]);
  });

  it("pauses for a fresh invocation when the deadline is near, and goes on from the saved state", async () => {
    const call = scripted([[{ name: "write_file", input: { path: "src/a.ts", content: "x\n" } }], [{ name: "finish", input: { title: "T", summary: "S" } }]]);
    let t = 0;
    const now = () => t;
    const first = await runBuildAgent({ brief: "b", snapshot: s, state: fresh(), deadline: TURN_BUDGET_MS + 10, call, now, save: async () => { t += 20; } });
    expect(first.status).toBe("paused");
    const second = await runBuildAgent({ brief: "b", snapshot: s, state: first.state, deadline: 10 * TURN_BUDGET_MS, call, now, save: async () => {} });
    expect(second.status).toBe("finished");
    expect(second.state.turns).toBe(2);
  });

  it("hands a turn that ran out of time to a fresh invocation, and gives up after it happens twice more", async () => {
    const timeout = Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" });
    const slow = vi.fn(async () => { throw timeout; });
    const saved: AgentState[] = [];
    const first = await runBuildAgent({ brief: "b", snapshot: s, state: fresh(), deadline: Date.now() + 600_000, call: slow, save: async (st) => { saved.push(st); } });
    expect(first.status).toBe("paused");
    expect(first.state.stalls).toBe(1);
    expect(first.state.turns).toBe(0);
    const second = await runBuildAgent({ brief: "b", snapshot: s, state: first.state, deadline: Date.now() + 600_000, call: slow, save: async () => {} });
    expect(second.state.stalls).toBe(2);
    await expect(runBuildAgent({ brief: "b", snapshot: s, state: second.state, deadline: Date.now() + 600_000, call: slow, save: async () => {} })).rejects.toThrow(/took too long/);
  });

  it("stops with a sentence: refusal, two empty finishes, nudges used up, or the turn limit", async () => {
    const refuse = vi.fn(async () => ({ stop_reason: "refusal", content: [] }) as unknown as ToolReply);
    await expect(runBuildAgent({ brief: "b", snapshot: s, state: fresh(), deadline: Date.now() + 600_000, call: refuse, save: async () => {} })).rejects.toThrow(/declined/);
    const empty = scripted([[{ name: "finish", input: { title: "T", summary: "The checkout code isn't in this repository." } }]]);
    await expect(runBuildAgent({ brief: "b", snapshot: s, state: fresh(), deadline: Date.now() + 600_000, call: empty, save: async () => {} })).rejects.toThrow(/couldn't make this change: The checkout code/);
    const silent = scripted([[]]);
    await expect(runBuildAgent({ brief: "b", snapshot: s, state: fresh(), deadline: Date.now() + 600_000, call: silent, save: async () => {} })).rejects.toBeInstanceOf(BuildError);
    const forever = scripted([[{ name: "list_files", input: {} }]]);
    await expect(runBuildAgent({ brief: "b", snapshot: s, state: { ...fresh(), turns: MAX_TURNS - 1 }, deadline: Date.now() + 600_000, call: forever, save: async () => {} })).rejects.toThrow(/turns/);
  });
});

/** A fake GitHub: answers by "METHOD path", records every call. */
function fakeGh(routes: Record<string, (body: unknown) => unknown>): Gh & { calls: { m: string; path: string; body: unknown }[] } {
  const calls: { m: string; path: string; body: unknown }[] = [];
  const gh = (async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const m = init.method ?? "GET";
    calls.push({ m, path, body: init.body });
    const r = routes[`${m} ${path}`];
    if (!r) throw new GithubAppError(404, "Not Found");
    return r(init.body);
  }) as Gh;
  return Object.assign(gh, { calls });
}

describe("the commit", () => {
  const tree = { "GET /repos/acme/web/git/commits/base1": () => ({ tree: { sha: "tree1" } }), "GET /repos/acme/web/git/trees/tree1?recursive=1": () => ({ tree: [{ path: "src/a.ts", mode: "100644", type: "blob" }, { path: "logo.png", mode: "100644", type: "blob" }, { path: "bin/run", mode: "100755", type: "blob" }] }) };

  it("writes one tree and one commit on the base, keeping each file's mode and leaving unchanged files out", async () => {
    const gh = fakeGh({ ...tree, "POST /repos/acme/web/git/trees": () => ({ sha: "tree2" }), "POST /repos/acme/web/git/commits": () => ({ sha: "commit2" }) });
    const staged = new Map([["src/a.ts", "new\n"], ["bin/run", "#!/bin/sh\necho hi\n"], ["src/same.ts", "same\n"], ["src/new.ts", "fresh\n"]]);
    const original = (p: string) => ({ "src/a.ts": "old\n", "bin/run": "#!/bin/sh\n", "src/same.ts": "same\n" } as Record<string, string>)[p] ?? null;
    const r = await commitStaged(gh, { repo: "acme/web", baseSha: "base1", staged, original, readable: new Set(["src/a.ts", "bin/run", "src/same.ts"]), message: "m\n\nPMA: VB-1" });
    expect(r).toEqual({ sha: "commit2", files: ["bin/run", "src/a.ts", "src/new.ts"] });
    const treeCall = gh.calls.find((c) => c.path === "/repos/acme/web/git/trees" && c.m === "POST")!;
    expect(treeCall.body).toEqual({ base_tree: "tree1", tree: [
      { path: "src/a.ts", mode: "100644", type: "blob", content: "new\n" },
      { path: "bin/run", mode: "100755", type: "blob", content: "#!/bin/sh\necho hi\n" },
      { path: "src/new.ts", mode: "100644", type: "blob", content: "fresh\n" },
    ] });
    expect(gh.calls.find((c) => c.path === "/repos/acme/web/git/commits" && c.m === "POST")!.body).toEqual({ message: "m\n\nPMA: VB-1", tree: "tree2", parents: ["base1"] });
  });

  it("refuses to overwrite a file PMA never read, or a guarded path, and refuses an empty change", async () => {
    const gh = fakeGh(tree);
    await expect(commitStaged(gh, { repo: "acme/web", baseSha: "base1", staged: new Map([["logo.png", "x"]]), original: () => null, readable: new Set(), message: "m" })).rejects.toThrow(/doesn't read/);
    await expect(commitStaged(gh, { repo: "acme/web", baseSha: "base1", staged: new Map([[".github/x.yml", "x"]]), original: () => null, readable: new Set(), message: "m" })).rejects.toThrow(/\.github/);
    await expect(commitStaged(gh, { repo: "acme/web", baseSha: "base1", staged: new Map([["src/a.ts", "old\n"]]), original: () => "old\n", readable: new Set(["src/a.ts"]), message: "m" })).rejects.toThrow(/nothing to commit/);
  });

  it("names a new branch, adding -2 when it exists; fast-forwards without force, and says so when the branch moved", async () => {
    let tries = 0;
    const gh = fakeGh({ "POST /repos/acme/web/git/refs": () => { if (tries++ === 0) throw new GithubAppError(422, "Reference already exists"); return {}; } });
    expect(await pushNewBranch(gh, "acme/web", "pma/vb-1-build-1", "c")).toBe("pma/vb-1-build-1-2");
    const moved = fakeGh({ "PATCH /repos/acme/web/git/refs/heads/feature/x": () => { throw new GithubAppError(422, "Update is not a fast forward"); } });
    await expect(fastForward(moved, "acme/web", "feature/x", "c")).rejects.toThrow(/Someone pushed to feature\/x/);
    expect(moved.calls[0].body).toEqual({ sha: "c", force: false });
  });

  it("describes the pull request with the summary, a link back, the task, and the marker, without pinging anyone", () => {
    const body = pullRequestBody({ summary: "Fixes pay for @sam.", task: "# Task\n\nAsk @product-team\n\nPMA: VB-1", issueUrl: "https://pma.example/a/b/issues/1", short: "VB-1" });
    expect(body).toContain("Fixes pay for @​sam.");
    expect(body).toContain("Ask @​product-team");
    expect(body).toContain("(https://pma.example/a/b/issues/1)");
    expect(body.trim().endsWith("PMA: VB-1")).toBe(true);
    expect(quietMentions("mail me at x@y.com, `@code`")).toBe("mail me at x@y.com, `@code`");
  });
});

describe("where a built issue stands", () => {
  const build = (status: BuildView["status"], at = "2026-10-17T12:00:00Z"): BuildView => ({ id: "b", mode: "new_pr", status, steps: [], files: [], error: null, pr_url: null, pr_number: null, head_branch: null, base_branch: null, created_at: at, updated_at: at });
  const approved = [{ kind: "approved", payload: { approximate: true, build: "new_pr" }, at: "2026-10-17T11:59:00Z" }];

  it("is building, then failed, then waiting on its pull request; Claude Code issues are unchanged", () => {
    expect(buildProgress({ status: "ready_to_build", activity: approved, pull_requests: [], build: build("running") }).next).toBe("building");
    expect(buildProgress({ status: "ready_to_build", activity: approved, pull_requests: [], build: null }).next).toBe("building");
    expect(buildProgress({ status: "ready_to_build", activity: approved, pull_requests: [], build: build("failed") }).next).toBe("build_failed");
    const pr = { id: "l", url: "u", repo: "acme/web", number: 3, state: "open", preview_url: null, linked_by_email: null, created_at: "2026-10-17T12:05:00Z" };
    expect(buildProgress({ status: "ready_to_build", activity: approved, pull_requests: [pr], build: build("opened") }).next).toBe("ship");
    const handOff = [{ kind: "approved", payload: { approximate: true, build: "claude_code" }, at: "2026-10-17T11:59:00Z" }];
    expect(buildProgress({ status: "ready_to_build", activity: handOff, pull_requests: [], build: null }).next).toBe("hand_off");
  });
});

describe("pull request events", () => {
  it("reads the PMA line however it's set", () => {
    expect(pmaMarker("Fixes pay.\n\nPMA: VB-12")).toBe("VB-12");
    expect(pmaMarker("> **PMA: ab12cd**\nmore")).toBe("ab12cd");
    expect(pmaMarker("Mentions PMA: in a sentence about VB-12 and more words")).toBeNull();
    expect(pmaMarker("")).toBeNull();
  });

  /** A tiny in-memory Supabase: eq/in/ilike/neq filters (dotted paths reach embedded rows), update, insert, select. */
  function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
    const get = (row: Record<string, unknown>, path: string) => path.split(".").reduce<unknown>((v, k) => (v as Record<string, unknown> | null)?.[k], row);
    const from = (table: string) => {
      const filters: ((r: Record<string, unknown>) => boolean)[] = [];
      let patch: Record<string, unknown> | null = null;
      const rows = () => (tables[table] ??= []).filter((r) => filters.every((f) => f(r)));
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (k: string, v: unknown) => { filters.push((r) => get(r, k) === v); return q; },
        neq: (k: string, v: unknown) => { filters.push((r) => get(r, k) !== v); return q; },
        in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(get(r, k))); return q; },
        ilike: (k: string, v: string) => { filters.push((r) => String(get(r, k)).toLowerCase() === v.toLowerCase()); return q; },
        order: () => q,
        update: (p: Record<string, unknown>) => { patch = p; return q; },
        insert: async (row: Record<string, unknown>) => { (tables[table] ??= []).push({ id: `new-${tables[table].length}`, ...row }); return { error: null }; },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown) => {
          if (patch) { const hit = rows(); for (const r of hit) Object.assign(r, patch); return ok({ data: hit, error: null }); }
          return ok({ data: rows(), error: null });
        },
      };
      return q;
    };
    return { from, tables } as never as { from: typeof from; tables: typeof tables };
  }

  const base = () => ({
    connections: [{ org_id: "org-a", kind: "github", external_id: "77", status: "ok" }, { org_id: "org-b", kind: "github", external_id: "88", status: "ok" }],
    projects: [{ id: "app-a", org_id: "org-a", repo_full_name: "Acme/Web", kind: "customer" }, { id: "app-b", org_id: "org-b", repo_full_name: "acme/web", kind: "customer" }],
    issues: [{ id: "i-a", project_id: "app-a", short_id: "aa11bb", status: "ready_to_build" }, { id: "i-b", project_id: "app-b", short_id: "aa11bb", status: "ready_to_build" }],
    pull_request_links: [] as Record<string, unknown>[],
    activity: [] as Record<string, unknown>[],
  });

  it("a PMA line links the pull request to that issue, only in the company that holds the installation", async () => {
    const db = fakeDb(base());
    const r = await onPullRequest({ action: "opened", installationId: "77", repo: "acme/web", number: 5, merged: false, body: "Fix\n\nPMA: AA11BB" }, db as never);
    expect(r.linked).toEqual(["i-a"]);
    expect(db.tables.pull_request_links).toEqual([expect.objectContaining({ issue_id: "i-a", url: "https://github.com/Acme/Web/pull/5", repo: "Acme/Web", number: 5, state: "open", linked_by: null })]);
    expect(db.tables.activity[0]).toMatchObject({ issue_id: "i-a", kind: "pr_linked", payload: { via: "marker", pr_number: 5 } });
    // An installation nobody holds does nothing.
    expect(await onPullRequest({ action: "opened", installationId: "99", repo: "acme/web", number: 6, merged: false, body: "PMA: aa11bb" }, db as never)).toEqual({ shipped: [], linked: [], closed: 0, reopened: 0 });
  });

  it("a merge ships the linked issue; a close without merging closes its link", async () => {
    const tables = base();
    const link = (n: number) => ({ id: `l${n}`, issue_id: "i-a", repo: "Acme/Web", number: n, state: "open", url: `https://github.com/Acme/Web/pull/${n}`, created_at: "2026-10-17T12:00:00Z", issues: tables.issues[0] });
    tables.pull_request_links.push(link(5), link(6));
    const db = fakeDb(tables);
    expect((await onPullRequest({ action: "closed", installationId: "77", repo: "acme/web", number: 6, merged: false, body: "" }, db as never)).closed).toBe(1);
    expect(tables.pull_request_links.find((l) => l.id === "l6")!.state).toBe("closed");
    const shipped = await onPullRequest({ action: "closed", installationId: "77", repo: "ACME/WEB", number: 5, merged: true, body: "" }, db as never);
    expect(shipped.shipped).toEqual(["i-a"]);
    expect(tables.issues[0].status).toBe("shipped");
    expect(tables.activity.find((a) => a.kind === "shipped")).toMatchObject({ user_id: null, payload: { via: "github", pr_number: 5 } });
    // The other company's issue with the same short id is untouched.
    expect(tables.issues[1].status).toBe("ready_to_build");
  });
});
