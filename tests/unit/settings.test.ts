import { describe, it, expect } from "vitest";
import { parseSettingsPatch } from "@/lib/settings";

describe("parseSettingsPatch", () => {
  it("accepts valid fields and drops unknown ones", () => {
    const r = parseSettingsPatch({
      design_path: "design", watched_branch: "main",
      slack_webhook_url: "https://hooks.slack.com/services/T/B/x",
      widget_origins: ["https://app.example.com"], route_map: { "/a": "scene/frame" },
      api_key: "nope",
    });
    expect("patch" in r && r.patch).toEqual({
      design_path: "design", watched_branch: "main",
      slack_webhook_url: "https://hooks.slack.com/services/T/B/x",
      widget_origins: ["https://app.example.com"], route_map: { "/a": "scene/frame" },
    });
  });
  it("refuses the repository with a sentence: it is connected through GitHub setup, not a settings save", () => {
    const refused = { error: "The repository is connected through GitHub setup." };
    expect(parseSettingsPatch({ repo_full_name: "acme/app" })).toEqual(refused);
    expect(parseSettingsPatch({ repo_full_name: "acme/app", design_path: "design", watched_branch: "main" })).toEqual(refused);
    expect(parseSettingsPatch({ repo_full_name: null })).toEqual(refused);
  });
  it("normalises widget origins and rejects invalid ones", () => {
    const ok = parseSettingsPatch({ widget_origins: ["https://app.example.com/path?x=1"] });
    expect("patch" in ok && ok.patch.widget_origins).toEqual(["https://app.example.com"]);
    expect(parseSettingsPatch({ widget_origins: ["not a url"] })).toHaveProperty("error");
    expect(parseSettingsPatch({ widget_origins: ["ftp://x.com"] })).toHaveProperty("error");
    expect(parseSettingsPatch({ widget_origins: "https://x.com" })).toHaveProperty("error");
    expect(parseSettingsPatch({ widget_origins: [1] })).toHaveProperty("error");
  });
  it("validates route_map as a string-to-string object", () => {
    expect(parseSettingsPatch({ route_map: {} })).toHaveProperty("patch");
    expect(parseSettingsPatch({ route_map: [] })).toHaveProperty("error");
    expect(parseSettingsPatch({ route_map: null })).toHaveProperty("error");
    expect(parseSettingsPatch({ route_map: { "/a": 1 } })).toHaveProperty("error");
  });
  it("validates slack webhook", () => {
    const empty = parseSettingsPatch({ slack_webhook_url: "" });
    expect("patch" in empty && empty.patch.slack_webhook_url).toBeNull();
    const nul = parseSettingsPatch({ slack_webhook_url: null });
    expect("patch" in nul && nul.patch.slack_webhook_url).toBeNull();
    expect(parseSettingsPatch({ slack_webhook_url: "https://evil.com/x" })).toHaveProperty("error");
    expect(parseSettingsPatch({ slack_webhook_url: 3 })).toHaveProperty("error");
  });
  it("refuses a patch that carries allowed_domains: sign-in no longer checks domains", () => {
    expect(parseSettingsPatch({ allowed_domains: ["a.com"] })).toEqual({ error: "That setting is gone." });
    expect(parseSettingsPatch({ allowed_domains: [], design_path: "design" })).toEqual({ error: "That setting is gone." });
  });
  it("rejects empty or non-object bodies", () => {
    expect(parseSettingsPatch({})).toHaveProperty("error");
    expect(parseSettingsPatch(null)).toHaveProperty("error");
    expect(parseSettingsPatch([])).toHaveProperty("error");
  });
  it("rejects unsafe design_path", () => {
    for (const v of ["/abs", "a/../b", "..", "a b", "a\\b", "", "a?x=1"]) expect(parseSettingsPatch({ design_path: v }), v).toHaveProperty("error");
    for (const v of ["design", "packages/web/design", "my_design.v2-x"]) expect(parseSettingsPatch({ design_path: v }), v).toHaveProperty("patch");
  });
  it("rejects unsafe watched_branch", () => {
    for (const v of ["a..b", "/main", "main/", "feat.lock", "a b", "a~1", "x:y"]) expect(parseSettingsPatch({ watched_branch: v }), v).toHaveProperty("error");
    for (const v of ["main", "feat/pma-v2", "release_1.2"]) expect(parseSettingsPatch({ watched_branch: v }), v).toHaveProperty("patch");
  });
});

describe("parseSettingsPatch alert_rules", () => {
  it("accepts alert rules and normalises them", () => {
    expect(parseSettingsPatch({ alert_rules: { recipients: ["u1"], blockingBug: false, jump: { enabled: true, points: 10 }, digest: { enabled: true } } })).toEqual({
      patch: { alert_rules: { recipients: ["u1"], blockingBug: false, jump: { enabled: true, points: 10 }, digest: { enabled: true } } },
    });
  });
  it("rejects alert rules that aren't an object", () => {
    expect(parseSettingsPatch({ alert_rules: "loud" })).toEqual({ error: "alert_rules must be an object" });
  });
});
