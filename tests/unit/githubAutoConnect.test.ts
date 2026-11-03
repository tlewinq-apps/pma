// Connect with GitHub connects the app's repository by itself when the installation was given exactly one.
import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "./fakeDb";
import { connectOnlyRepository } from "@/lib/github/autoConnect";

const repo = (full_name: string) => ({ full_name, private: true, default_branch: "main" });
const app = (over: Record<string, unknown> = {}) => ({ id: "app-1", org_id: "org-1", kind: "customer", repo_full_name: null, ...over });
const deps = (repos: string[], readable = true) => ({ repos: vi.fn(async () => repos.map(repo)), read: vi.fn(async () => (readable ? { ref: "main" } : null)) });
const scope = { orgId: "org-1", projectId: "app-1" };

describe("connectOnlyRepository", () => {
  it("connects the one repository the installation was given, after reading it", async () => {
    const state = fakeDb({ projects: [app()] });
    const d = deps(["acme/celeste-app"]);
    expect(await connectOnlyRepository("42", scope, state.db as never, d)).toBe("acme/celeste-app");
    expect(d.read).toHaveBeenCalledWith("acme/celeste-app", "org-1");
    expect(state.writes).toEqual([{ table: "projects", op: "update", values: { repo_full_name: "acme/celeste-app", watched_branch: "main" } }]);
  });

  it("leaves the picker when there are several repositories, none, or the one can't be read", async () => {
    for (const [repos, readable] of [[["a/one", "a/two"], true], [[], true], [["a/one"], false]] as const) {
      const state = fakeDb({ projects: [app()] });
      expect(await connectOnlyRepository("42", scope, state.db as never, deps([...repos], readable))).toBeNull();
      expect(state.writes).toEqual([]);
    }
  });

  it("never changes an app that already has a repository, or the demo", async () => {
    for (const over of [{ repo_full_name: "acme/web" }, { kind: "demo" }]) {
      const state = fakeDb({ projects: [app(over)] });
      const d = deps(["acme/celeste-app"]);
      expect(await connectOnlyRepository("42", scope, state.db as never, d)).toBeNull();
      expect(d.repos).not.toHaveBeenCalled();
      expect(state.writes).toEqual([]);
    }
  });
});
