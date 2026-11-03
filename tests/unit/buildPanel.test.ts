// The build panel's two steps that act on people: Waiting for the pull request keeps Copy task and Download task in
// view (only the explanation is folded away), and Mark as shipped carries its warning as visible text, since pressing
// it tells everyone who raised the issue in Slack. Rendered to HTML.
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const app = vi.hoisted(() => ({ role: "owner" as "owner" | "admin" | "member" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/components/app/AppContext", () => ({ useApp: () => ({ api: (p: string) => `/api/apps/x${p}`, href: (p: string) => `/acme/app${p}`, appId: "x", role: app.role }) }));

import { BuildPanel } from "@/components/workspace/BuildPanel";
import { SHIP_NOTE } from "@/lib/handoff/build";
import type { IssueDetail } from "@/lib/queries/issueDetail";
import type { LiveView } from "@/lib/github/live";

const NOW = Date.parse("2026-10-17T12:00:00Z");
const approved = { kind: "approved", payload: { approximate: true, build: "claude_code" }, at: "2026-10-17T10:00:00Z" };
const handedOff = { kind: "handed_off", payload: { via: "copy" }, at: "2026-10-17T10:30:00Z" };
const pr = { id: "l1", url: "https://github.com/acme/app/pull/7", repo: "acme/app", number: 7, state: "open", preview_url: null, linked_by_email: null, created_at: "2026-10-17T11:00:00Z" };

function panel(o: { activity: object[]; pull_requests?: object[]; role?: "owner" | "admin" | "member"; live?: LiveView | null }) {
  app.role = o.role ?? "owner";
  const d = {
    id: "i1", short_id: "ABC123", status: "ready_to_build", owner_email: null,
    project: { repo_full_name: "acme/app", build_branch: null, build_caps: { githubConnected: false, githubWrite: false } },
    activity: o.activity, pull_requests: o.pull_requests ?? [], build: null,
  } as unknown as IssueDetail;
  return renderToStaticMarkup(createElement(BuildPanel, { d, me: "me@acme.test", now: NOW, solutionId: "s1", solutionTitle: "Fit the look", zip: true, live: o.live ?? null }));
}
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("Waiting for the pull request", () => {
  it("keeps Copy task and Download task in view, ahead of the folded explanation", () => {
    for (const role of ["owner", "member"] as const) {
      const html = panel({ activity: [approved, handedOff], role });
      expect(text(html), role).toContain("Waiting for the pull request");
      const fold = html.indexOf("How the pull request gets linked");
      expect(fold, role).toBeGreaterThan(-1);
      const visible = html.slice(0, fold);
      expect(text(visible), role).toContain("Copy task for Claude Code");
      expect(text(visible), role).toContain("Download task");
      expect(visible, role).toContain("format=zip");
      // The MCP route sits beside them, for the issue's own short id.
      expect(text(visible), role).toContain("Copy Claude Code prompt");
      expect(visible, role).toContain('data-pull="ABC123"');
      // Only the explanation sits behind the disclosure, and it no longer repeats the actions.
      const folded = html.slice(fold);
      expect(text(folded), role).toContain("PMA: ABC123");
      expect(text(folded), role).not.toMatch(/Copy task|Download task/);
    }
  });

  it("still folds the explanation, and the Link pull request button stays for people who may link", () => {
    expect(text(panel({ activity: [approved, handedOff] }))).toContain("Link pull request");
    expect(text(panel({ activity: [approved, handedOff], role: "member" }))).not.toContain("Link pull request");
  });
});

describe("Next: hand it to Claude Code", () => {
  it("offers Copy task, Download task and Copy Claude Code prompt in view, with Connect Claude in the explanation", () => {
    const html = panel({ activity: [approved] });
    const t = text(html);
    expect(t).toContain("Next: hand it to Claude Code");
    const fold = html.indexOf("What the task holds");
    expect(fold).toBeGreaterThan(-1);
    for (const action of ["Copy task for Claude Code", "Download task", "Copy Claude Code prompt"]) expect(text(html.slice(0, fold)), action).toContain(action);
    expect(html.slice(fold)).toContain('href="/acme/app/settings#claude"');
  });
});

describe("Mark as shipped", () => {
  it("shows its warning as visible text beside the button, not only in a tooltip", () => {
    const html = panel({ activity: [approved, handedOff], pull_requests: [pr], role: "admin" });
    expect(text(html)).toContain("Mark as shipped");
    expect(html).toContain(`<p id="ship-note" class="text-xs text-muted-foreground">${SHIP_NOTE}</p>`);
    expect(SHIP_NOTE).toMatch(/Slack/);
    expect(SHIP_NOTE).toMatch(/shipped/);
    expect(SHIP_NOTE).not.toMatch(/\n/);
    expect(html).toMatch(/<button[^>]*aria-describedby="ship-note"[^>]*>(?:(?!<\/button>).)*Mark as shipped/);
    const button = html.match(/<button[^>]*aria-describedby="ship-note"[^>]*>/)![0];
    expect(button).not.toContain("title=");
  });

  it("is for owners and admins only: a member sees neither the button nor its note", () => {
    const html = panel({ activity: [approved, handedOff], pull_requests: [pr], role: "member" });
    expect(text(html)).not.toContain("Mark as shipped");
    expect(html).not.toContain("ship-note");
  });
});

describe("the preview step, with See it live", () => {
  const live = (url: string | null): LiveView => ({ needs: null, noPreviews: false, manageUrl: null,
    prs: [{ number: 7, url: pr.url, checks: null, preview: url ? { state: "ready", url, logUrl: null, provider: "Vercel", updatedAt: "2026-10-17T11:50:00Z" } : { state: "building", url: null, logUrl: null, provider: "Vercel", updatedAt: "2026-10-17T11:50:00Z" } }] });
  const previewStep = (html: string) => html.match(/<li[^>]*>(?:(?!<\/li>).)*Preview(?:(?!<\/li>).)*<\/li>/)![0];

  it("counts a preview GitHub reports as done, so nobody pastes one", () => {
    const html = panel({ activity: [approved, handedOff], pull_requests: [pr], live: live("https://app-7.vercel.app") });
    expect(text(previewStep(html))).toContain("Preview, done");
    expect(text(html)).not.toContain("Add a preview link");
  });

  it("leaves it optional, with Add a preview link, while there's no preview ready", () => {
    for (const l of [null, live(null)]) {
      const html = panel({ activity: [approved, handedOff], pull_requests: [pr], live: l });
      expect(text(previewStep(html))).toContain("Preview (optional)");
      expect(text(html)).toContain("Add a preview link");
    }
  });
});
