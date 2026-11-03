// Connecting Claude to PMA from Settings: the Use PMA from Claude card shows the endpoint and the claude mcp add command
// with a placeholder (the page never ships the key), Show key for owners and admins, and who to ask for members. The
// key itself comes from GET /api/apps/[appId]/api-key: owners and admins only, outsiders a 404.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const h = vi.hoisted(() => ({ role: "owner" as "owner" | "admin" | "member", ctx: null as null | { role: string; project: { api_key: string } } }));
vi.mock("@/components/app/AppContext", () => ({ useApp: () => ({ api: (p: string) => `/api/apps/x${p}`, href: (p: string) => `/acme/app${p}`, appId: "x", role: h.role }) }));
vi.mock("@/lib/db/app", () => ({ appById: async () => h.ctx, hasRole: (ctx: { role: string }, roles: string[]) => roles.includes(ctx.role) }));

import { ClaudeCard } from "@/app/(app)/[org]/[app]/settings/ClaudeCard";
import { GET as apiKey } from "@/app/api/apps/[appId]/api-key/route";
import { KEY_FORBIDDEN, KEY_PLACEHOLDER, MCP_ASKS, mcpAddCommand, mcpEndpoint, pullTaskPrompt } from "@/lib/mcp/connect";
import { MCP_TOOLS } from "@/lib/mcp/server";

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const card = (role: typeof h.role, appUrl = "https://pma.example.com/") => { h.role = role; return text(renderToStaticMarkup(createElement(ClaudeCard, { appUrl, keyPrefix: "abc123" }))); };

describe("the connect copy", () => {
  it("builds the endpoint and the Claude Code command", () => {
    expect(mcpEndpoint("https://pma.example.com/")).toBe("https://pma.example.com/api/mcp");
    expect(mcpEndpoint("")).toBe("https://YOUR-PMA-URL/api/mcp");
    expect(mcpAddCommand("https://pma.example.com/api/mcp")).toBe(`claude mcp add --transport http pma https://pma.example.com/api/mcp --header "Authorization: Bearer ${KEY_PLACEHOLDER}"`);
  });

  it("names a real tool for every example ask", () => {
    for (const a of MCP_ASKS) expect(MCP_TOOLS as readonly string[]).toContain(a.tool);
  });

  it("gives the approved issue's prompt the tool, the issue, and what to do when PMA isn't connected", () => {
    const p = pullTaskPrompt("a1b2c3");
    expect(p).toMatch(/^Build PMA issue a1b2c3: /);
    expect(p).toContain("get_build_task");
    expect(MCP_TOOLS as readonly string[]).toContain("get_build_task");
    expect(p).toContain("Use PMA from Claude");
    expect(p).not.toMatch(/\n/);
  });
});

describe("Use PMA from Claude", () => {
  it("shows when to use it, the command with a placeholder, and Show key for owners and admins", () => {
    for (const role of ["owner", "admin"] as const) {
      const t = card(role);
      expect(t, role).toContain("Use PMA from Claude");
      for (const a of MCP_ASKS) expect(t, role).toContain(a.ask);
      expect(t, role).toContain(mcpAddCommand("https://pma.example.com/api/mcp"));
      expect(t, role).toContain("Show key");
      expect(t, role).toContain("it starts abc123");
      expect(t, role).toContain("feedback still comes in through Slack");
    }
  });

  it("tells a member who has the key, with no Show key button", () => {
    const t = card("member");
    expect(t).not.toContain("Show key");
    expect(t).toContain(`Ask a company owner or admin for this app's API key (it starts abc123) and put it in place of ${KEY_PLACEHOLDER}.`);
    expect(t).toContain("Copy command");
  });
});

describe("GET /api/apps/[appId]/api-key", () => {
  const get = () => apiKey(new Request("https://pma.test/api/apps/x/api-key"), { params: Promise.resolve({ appId: "x" }) });

  it("gives owners and admins the key, never cached", async () => {
    for (const role of ["owner", "admin"]) {
      h.ctx = { role, project: { api_key: "k_live_123" } };
      const res = await get();
      expect(res.status, role).toBe(200);
      expect(await res.json(), role).toEqual({ key: "k_live_123" });
      expect(res.headers.get("cache-control"), role).toBe("no-store");
    }
  });

  it("refuses a member, and is a 404 for anyone outside the company", async () => {
    h.ctx = { role: "member", project: { api_key: "k_live_123" } };
    const res = await get();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: KEY_FORBIDDEN });
    h.ctx = null;
    expect((await get()).status).toBe(404);
  });
});
