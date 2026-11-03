// The PMA GitHub App's manifest, for GitHub's "create an app from a manifest" flow (scripts/github-app.ts). Contents
// and pull requests: write, because Build it commits the approved change on a branch and opens its pull request (never
// merges); the same token reads the code. Deployments, checks and commit statuses: read, for See it live (the pull
// request's preview site and its checks, lib/github/live). It subscribes to pull_request, so a merged pull request
// ships its issue and a pull request carrying a Copy task's "PMA: <short>" line links itself. Installation events
// reach the webhook whatever it subscribes to. The production app has the webhook; the dev app has none, since GitHub
// can't reach localhost. An app registered earlier gets the same permissions on its settings page, and each
// installation accepts them.
export type GithubAppManifest = {
  name: string; url: string; description: string; public: boolean; redirect_url: string;
  callback_urls: string[]; setup_url: string; setup_on_update: boolean; request_oauth_on_install: boolean;
  hook_attributes?: { url: string; active: boolean };
  default_permissions: Record<string, "read" | "write">; default_events: string[];
};

export function githubAppManifest(o: { appUrl: string; name: string; redirectUrl: string; webhook: boolean }): GithubAppManifest {
  const base = o.appUrl.replace(/\/+$/, "");
  return {
    name: o.name, url: base, public: true,
    description: "PMA turns what people say about your product into fixes. It reads your code to find where feedback points.",
    redirect_url: o.redirectUrl,
    callback_urls: [`${base}/api/github/callback`],
    setup_url: `${base}/api/github/setup`, setup_on_update: true,
    // PMA asks for the sign-in itself, after the install, so it can check the installation with PKCE and its own state.
    request_oauth_on_install: false,
    ...(o.webhook ? { hook_attributes: { url: `${base}/api/github/webhook/app`, active: true } } : {}),
    default_permissions: { contents: "write", pull_requests: "write", deployments: "read", checks: "read", statuses: "read", metadata: "read" },
    default_events: ["pull_request"],
  };
}
