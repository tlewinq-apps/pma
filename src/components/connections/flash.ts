// What an OAuth hand-off came back with (?connect=slack&ok=1, &pick=1 or &error=<reason>), for the Connect cards.
import type { Flash } from "./ToolCards";

const TOOLS = new Set(["slack", "posthog"]);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function flashFrom(sp: Record<string, string | string[] | undefined>): Flash {
  const tool = one(sp.connect);
  if (!tool || !TOOLS.has(tool)) return null;
  const error = one(sp.error);
  return { tool: tool as "slack" | "posthog", ok: one(sp.ok) === "1" && !error, pick: one(sp.pick) === "1", error: error && /^[a-z_]{1,30}$/.test(error) ? error : error ? "failed" : null };
}
