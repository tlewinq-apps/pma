import { describe, it, expect } from "vitest";
import { connectionRows, feedbackSourceRows, integrationRows } from "@/lib/health";

describe("feedbackSourceRows", () => {
  it("only calls a source Live when something backs it", () => {
    const rows = feedbackSourceRows({ slackLive: false, widgetOrigins: 0 });
    const state = Object.fromEntries(rows.map((r) => [r.name, r.state]));
    expect(state).toMatchObject({ "Paste and files": "Live", "In-app widget": "Live", Slack: "Not connected", API: "Live", Granola: "Not connected yet", PostHog: "Not connected yet" });
    expect(rows.map((r) => r.state)).not.toContain("Demo data");
  });

  it("shows Slack live once connected, naming the real front-door channel", () => {
    const slack = feedbackSourceRows({ slackLive: true, widgetOrigins: 0 }).find((r) => r.name === "Slack");
    expect(slack?.state).toBe("Live");
    expect(slack?.desc).toContain("#pma-feedback");
  });

  it("says the widget takes any site until origins restrict it", () => {
    const desc = (n: number) => feedbackSourceRows({ slackLive: false, widgetOrigins: n }).find((r) => r.name === "In-app widget")?.desc;
    expect(desc(0)).toMatch(/any site/i);
    expect(desc(2)).toMatch(/2 allowed sites/i);
  });
});

describe("integrationRows", () => {
  const all = { anthropic: true, voyage: true, deepgram: true, slack: { token: true, signing: true, inbox: true }, drafting: "github" as const, canvas: "acme/app on main" as string | null, appUrl: "https://pma.example.com", cron: true };
  const state = (f: typeof all) => Object.fromEntries(integrationRows(f).map((r) => [r.name, r.state]));

  it("calls everything Live when it is all connected", () => {
    expect(new Set(Object.values(state(all)))).toEqual(new Set(["Live"]));
  });

  it("separates what is simulated from what is missing, and says how to fix it", () => {
    const rows = integrationRows({ ...all, voyage: false, deepgram: false, drafting: "mock", canvas: null, anthropic: false, appUrl: "http://localhost:3000", slack: { token: true, signing: false, inbox: false } });
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by["Embeddings"].state).toBe("Simulated");
    expect(by["Recordings"].state).toBe("Simulated");
    expect(by["Design canvas"]).toMatchObject({ state: "Simulated", detail: expect.stringMatching(/built-in sample/i), fix: expect.stringContaining("GITHUB_TOKEN") });
    expect(by["Design and drafting"]).toMatchObject({ state: "Simulated", detail: expect.stringMatching(/mock runner/i) });
    expect(by["Claude"]).toMatchObject({ state: "Missing", fix: expect.stringContaining("ANTHROPIC_API_KEY") });
    expect(by["Public URL"].state).toBe("Missing");
    expect(by["Slack"]).toMatchObject({ state: "Missing", fix: expect.stringContaining("SLACK_SIGNING_SECRET") });
  });

  it("names the repo and branch the canvas is read from once one is connected", () => {
    const canvas = integrationRows(all).find((r) => r.name === "Design canvas");
    expect(canvas).toMatchObject({ state: "Live", detail: expect.stringContaining("acme/app on main") });
  });

  it("uses no emoji and keeps every detail to plain words", () => {
    for (const r of integrationRows({ ...all, drafting: "demo" })) expect(`${r.detail}${r.fix ?? ""}`).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("connectionRows (a customer app's Settings)", () => {
  const base = { repo: "acme/web-app" as string | null, branch: "main" as string | null, widgetSources: 0, widgetOrigins: 0 };
  const by = (f: typeof base) => Object.fromEntries(connectionRows(f).map((r) => [r.name, r]));

  it("names the repository and the widget's status (the tools have their own Connect cards)", () => {
    const rows = by(base);
    expect(Object.keys(rows)).toEqual(["Repository", "In-app widget"]);
    expect(rows.Repository).toMatchObject({ state: "Connected", detail: expect.stringContaining("acme/web-app on main") });
    expect(rows["In-app widget"]).toMatchObject({ state: "Not seen yet" });
    expect(by({ ...base, widgetSources: 3, widgetOrigins: 1 })["In-app widget"]).toMatchObject({ state: "Live", detail: expect.stringContaining("1 allowed site") });
    expect(by({ ...base, repo: null, branch: null }).Repository.state).toBe("Not connected");
  });

  it("never puts a full stop straight after a repository name that ends in one", () => {
    for (const branch of ["main", null]) {
      const detail = by({ ...base, repo: "acme/Closet.", branch }).Repository.detail;
      expect(detail, String(branch)).not.toMatch(/Closet\.\./);
      expect(detail).toContain("acme/Closet.");
    }
  });

  it("never mentions the demo's sample canvas, the mock runner or environment variables", () => {
    for (const f of [base, { ...base, repo: null, branch: null }]) {
      const text = connectionRows(f).map((r) => r.detail).join(" ");
      expect(text).not.toMatch(/sample canvas|mock runner|GitHub Action|_KEY|GITHUB_TOKEN|Marver/);
    }
  });

  it("a customer app's Slack, Granola and PostHog point at its own Connect cards", () => {
    const rows = Object.fromEntries(feedbackSourceRows({ slackLive: false, widgetOrigins: 0, customer: true }).map((r) => [r.name, r]));
    expect(rows.Slack).toEqual({ name: "Slack", desc: "Connect to Slack under Connections", state: "Not connected" });
    expect(rows.Granola).toEqual({ name: "Granola", desc: "Connect to Granola under Connections", state: "Not connected" });
    const live = Object.fromEntries(feedbackSourceRows({ slackLive: true, widgetOrigins: 0, customer: true, granolaLive: true, posthogLive: true }).map((r) => [r.name, r.state]));
    expect(live).toMatchObject({ Slack: "Live", Granola: "Live", PostHog: "Live" });
    expect(JSON.stringify(feedbackSourceRows({ slackLive: true, widgetOrigins: 0, customer: true }))).not.toMatch(/#pma\b/i);
  });
});
