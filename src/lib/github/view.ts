// What the repository step and Build it show about GitHub for a company: whether this deployment has the PMA GitHub
// App, whether the company has connected an installation (and on which account), whether that installation lets PMA
// commit and open pull requests (Build it), and why it needs attention. Never a token.
import { findConnection } from "@/lib/connections/store";
import { githubAppEnabled } from "./app";
import { canWrite } from "./install";

export type GithubView = { enabled: boolean; connected: boolean; account: string | null; reason: string | null; write: boolean };

export async function githubView(orgId: string): Promise<GithubView> {
  if (!githubAppEnabled()) return { enabled: false, connected: false, account: null, reason: null, write: false };
  const c = await findConnection("github", { orgId, projectId: null }).catch(() => null);
  const connected = !!c?.external_id && (c.status === "ok" || c.status === "broken");
  return {
    enabled: true, connected,
    account: connected && typeof c?.display.account === "string" ? c.display.account : null,
    reason: c && (c.status === "broken" || c.status === "revoked") ? c.status_reason : null,
    write: connected && canWrite(c?.display.permissions),
  };
}
