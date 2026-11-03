import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { configPushProblem, configPushArgs, devRef } from "../../scripts/supabase-config-push";

const DEV = "devdevdevdevdevdevde";
const PROD = "prodprodprodprodprod";
beforeEach(() => { vi.stubEnv("PMA_DEV_SUPABASE_REF", DEV); vi.stubEnv("PMA_PROD_SUPABASE_REF", PROD); });
afterEach(() => vi.unstubAllEnvs());

describe("supabase:config-push link check", () => {
  it("allows only the dev project", () => {
    expect(devRef()).toBe(DEV);
    expect(configPushProblem(DEV)).toBeNull();
    expect(configPushProblem(`${DEV}\n`)).toBeNull();
  });

  it("always refuses production", () => {
    expect(configPushProblem(PROD)).toMatch(/production/);
    expect(configPushProblem(`${PROD}\n`)).toMatch(/production/);
  });

  it("refuses any other project, and a folder that isn't linked", () => {
    expect(configPushProblem("abcdefghijklmnopqrst")).toMatch(/abcdefghijklmnopqrst.*not dev/);
    expect(configPushProblem(null)).toMatch(/isn't linked/);
    expect(configPushProblem("")).toMatch(/isn't linked/);
    expect(configPushProblem("  \n")).toMatch(/isn't linked/);
  });

  it("refuses everything until the dev project is named", () => {
    vi.stubEnv("PMA_DEV_SUPABASE_REF", "");
    expect(configPushProblem(DEV)).toMatch(/PMA_DEV_SUPABASE_REF/);
  });
});

describe("supabase:config-push arguments", () => {
  it("always targets dev explicitly", () => {
    expect(configPushArgs([])).toEqual(["config", "push", "--project-ref", DEV]);
  });

  it("passes through --yes and --agent, nothing else", () => {
    expect(configPushArgs(["--yes"])).toEqual(["config", "push", "--project-ref", DEV, "--yes"]);
    expect(configPushArgs(["--agent=no"])).toEqual(["config", "push", "--project-ref", DEV, "--agent=no"]);
    expect(configPushArgs(["--agent", "no"])).toEqual(["config", "push", "--project-ref", DEV, "--agent", "no"]);
  });

  it("refuses anything that could point the push somewhere else", () => {
    for (const args of [["--project-ref", PROD], [`--project-ref=${PROD}`], ["--workdir", "/tmp"], ["--profile", "x"], ["--agent", "--project-ref"], ["--agent"], ["extra"]]) {
      expect(configPushArgs(args), args.join(" ")).toMatch(/only takes --yes and --agent/);
    }
  });
});
