// PMA's MCP server for Claude (lib/mcp/server.ts), as one streamable HTTP endpoint. Authorization: Bearer <the app's
// API key>, the same key /api/v1 takes, and every tool is scoped to that key's app. Stateless: each POST gets a fresh
// server and transport and is answered with JSON, so it runs as an ordinary function with no session store. GET (a
// stream of server-initiated messages) and DELETE (ending a session) have nothing to serve here, so they are 405.
//
// The auth proxy skips this path (src/proxy.ts, isPublicPath): there is no signed-in session, only the key.
import { NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { projectForApiKey } from "@/lib/api/auth";
import { pmaMcpServer } from "@/lib/mcp/server";

// add_feedback runs the pipeline after answering, as POST /api/v1/feedback does.
export const maxDuration = 300;

export async function POST(req: Request) {
  const app = await projectForApiKey(req);
  if (!app) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "www-authenticate": 'Bearer realm="PMA"' } });
  const server = pmaMcpServer(app);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await server.close();
  }
}

const notAllowed = () => NextResponse.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }, { status: 405, headers: { allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
