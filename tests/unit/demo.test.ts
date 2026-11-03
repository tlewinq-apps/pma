import { describe, it, expect } from "vitest";
import { draftBackend, demoAdvanceDue, renderDemoFrame, demoBranch, DEMO_DRAFT_MS } from "@/lib/drafts/demo";

describe("draftBackend", () => {
  const demo = (repo: string | null) => ({ kind: "demo", repo_full_name: repo });
  const customer = (repo: string | null) => ({ kind: "customer", repo_full_name: repo });
  it("drafts on GitHub only for the demo app, with both a repo and a token", () => {
    expect(draftBackend(demo("acme/app"), "ghp_x", "")).toBe("github");
    expect(draftBackend(demo("acme/app"), undefined, "")).toBe("demo");
    expect(draftBackend(demo(null), "ghp_x", "")).toBe("demo");
    expect(draftBackend(demo("acme/app"), "", "")).toBe("demo");
  });
  it("never gives a customer app GitHub, even with a repo and the deployment's token", () => {
    expect(draftBackend(customer("acme/app"), "ghp_x", "")).toBe("demo");
    expect(draftBackend(customer("acme/app"), "ghp_x", null)).toBe("demo");
    expect(draftBackend(customer("acme/app"), "ghp_x", "mock")).toBe("mock");
    expect(draftBackend({ kind: null, repo_full_name: "acme/app" }, "ghp_x", "")).toBe("demo");
  });
});

describe("demoAdvanceDue", () => {
  const t0 = Date.parse("2026-10-15T12:00:00Z");
  const d = (o: object) => ({ status: "dispatched", demo: true, created_at: "2026-10-15T12:00:00Z", ...o });
  it("advances a demo dispatch once it is old enough", () => {
    expect(demoAdvanceDue(d({}), t0 + DEMO_DRAFT_MS)).toBe(true);
    expect(demoAdvanceDue(d({}), t0 + DEMO_DRAFT_MS - 1)).toBe(false);
  });
  it("never advances real, finished or unparseable drafts", () => {
    expect(demoAdvanceDue(d({ demo: false }), t0 + 60_000)).toBe(false);
    expect(demoAdvanceDue(d({ status: "ready" }), t0 + 60_000)).toBe(false);
    expect(demoAdvanceDue(d({ created_at: "nope" }), t0 + 60_000)).toBe(false);
    expect(demoAdvanceDue(null, t0)).toBe(false);
  });
});

describe("renderDemoFrame", () => {
  const svg = (uri: string) => decodeURIComponent(uri.replace(/^data:image\/svg\+xml;charset=utf-8,/, ""));
  it("returns an SVG data URI labelled as a demo render", () => {
    const uri = renderDemoFrame({ title: "Early pickup", description: "Form: time, who is collecting", side: "before" });
    expect(uri.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(svg(uri)).toContain("<svg");
    expect(svg(uri)).toContain("Demo render");
    expect(svg(uri)).toContain("Early pickup");
  });
  it("adds the proposal on the after side", () => {
    const s = svg(renderDemoFrame({ title: "Early pickup", description: "Form", side: "after", proposal: { title: "Explicit sent states", summary: "Show a confirmation" } }));
    expect(s).toContain("Explicit sent states");
    expect(s).toContain("Show a confirmation");
  });
  it("escapes markup in every text field", () => {
    const s = svg(renderDemoFrame({ title: `<script>"x"&`, description: "a<b", side: "after", proposal: { title: "<img>", summary: "'q'" } }));
    expect(s).not.toContain("<script>");
    expect(s).not.toContain("<img>");
    expect(s).toContain("&lt;script&gt;&quot;x&quot;&amp;");
    expect(s).toContain("&#39;q&#39;");
  });
});

describe("demoBranch", () => {
  it("is a readable demo/ branch name", () => expect(demoBranch("a1b2", "Early pickup fails silently!", "abcdef123")).toBe("demo/a1b2-early-pickup-fails-silently-abcdef"));
});
