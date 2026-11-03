// How people connect Claude to PMA's MCP server (lib/mcp/server.ts, /api/mcp), and what they then ask it. Pure, with
// no server imports: the Settings card, the issue page's hand-off step and the tests share this copy.

export const MCP_PATH = "/api/mcp";
/** Stands in for the app's API key wherever the key itself isn't shown. */
export const KEY_PLACEHOLDER = "YOUR_PMA_API_KEY";
/** GET /api/apps/[appId]/api-key's answer to a member: the key is for owners and admins to hand out. */
export const KEY_FORBIDDEN = "Only company owners and admins can see the API key.";
/** The anchor of the Settings card, for links from the issue page. */
export const CLAUDE_CARD_ID = "claude";

/** The endpoint, from the app's public address (APP_URL); a placeholder when there isn't one. */
export const mcpEndpoint = (appUrl: string) => `${(appUrl.trim() || "https://YOUR-PMA-URL").replace(/\/+$/, "")}${MCP_PATH}`;

/** The one command that adds PMA to Claude Code. */
export const mcpAddCommand = (endpoint: string, key: string = KEY_PLACEHOLDER) =>
  `claude mcp add --transport http pma ${endpoint} --header "Authorization: Bearer ${key}"`;

/** What a PM or an engineer asks Claude once it's connected, with the tool that answers. */
export const MCP_ASKS: readonly { ask: string; who: "pm" | "engineer"; tool: string }[] = [
  { ask: "What are the most urgent bugs right now?", who: "pm", tool: "list_issues" },
  { ask: "What did customers say about a1b2c3, and where is it in the code?", who: "pm", tool: "get_issue" },
  { ask: "File these call notes with PMA.", who: "pm", tool: "add_feedback" },
  { ask: "Build the approved PMA issue a1b2c3.", who: "engineer", tool: "get_build_task" },
];

/** The hand-off step's line on the issue page: the same task, pulled from Claude Code instead of copied. */
export const pullTaskLine = (short: string) => `Working in Claude Code with PMA connected? Ask it to build PMA issue ${short}: it gets this same task, and its pull request links back here.`;
