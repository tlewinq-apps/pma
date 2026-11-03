// Honest status lines for Settings: where feedback comes from, which integrations are live or simulated (the demo's
// Demo health card), and a customer app's connections (its Connections card).

export type SourceState = "Live" | "Not connected" | "Not connected yet";
export type FeedbackSourceRow = { name: string; desc: string; state: SourceState };

export function feedbackSourceRows(f: { slackLive: boolean; widgetOrigins: number; customer?: boolean; granolaLive?: boolean; posthogLive?: boolean; sentryLive?: boolean }): FeedbackSourceRow[] {
  // A customer app connects Slack, Granola, PostHog and Sentry in its own accounts, under Connections.
  const slack: FeedbackSourceRow = f.slackLive
    ? { name: "Slack", desc: f.customer ? "Your feedback channel and the Send to PMA shortcut" : "#pma-feedback and the Send to PMA shortcut", state: "Live" }
    : f.customer
      ? { name: "Slack", desc: "Connect to Slack under Connections", state: "Not connected" }
      : { name: "Slack", desc: "Set up the Slack app above", state: "Not connected" };
  if (f.customer) {
    return [
      { name: "Paste and files", desc: "Text, documents and screenshots on Add feedback", state: "Live" },
      { name: "In-app widget", desc: f.widgetOrigins ? `Feedback button in your product, ${f.widgetOrigins} allowed sites` : "Feedback button in your product, from any site until you list origins under Widget", state: "Live" },
      slack,
      { name: "API", desc: "POST /api/v1/feedback with your API key", state: "Live" },
      { name: "Granola", desc: f.granolaLive ? "Meeting notes from your Granola workspace" : "Connect to Granola under Connections", state: f.granolaLive ? "Live" : "Not connected" },
      { name: "PostHog", desc: f.posthogLive ? "Errors and rage clicks that size each issue" : "Connect to PostHog under Connections", state: f.posthogLive ? "Live" : "Not connected" },
      { name: "Sentry", desc: f.sentryLive ? "Crashes that size each issue, and User Feedback as feedback" : "Connect to Sentry under Connections", state: f.sentryLive ? "Live" : "Not connected" },
    ];
  }
  return [
    { name: "Paste and files", desc: "Text, documents and screenshots on Add feedback", state: "Live" },
    // An empty origin list accepts any site (validateWidgetRequest), so the widget is always on.
    { name: "In-app widget", desc: f.widgetOrigins ? `Feedback button in your product, ${f.widgetOrigins} allowed sites` : "Feedback button in your product, from any site until you list origins under Widget", state: "Live" },
    slack,
    { name: "API", desc: "POST /api/v1/feedback with your API key", state: "Live" },
    { name: "Granola", desc: "Meeting notes", state: "Not connected yet" },
    { name: "PostHog", desc: "Surveys and session notes", state: "Not connected yet" },
  ];
}

export type HealthState = "Live" | "Simulated" | "Missing";
export type HealthRow = { name: string; state: HealthState; detail: string; fix?: string };
export type HealthFacts = {
  anthropic: boolean; voyage: boolean; deepgram: boolean; slack: { token: boolean; signing: boolean; inbox: boolean };
  drafting: "github" | "mock" | "demo";
  /** Where screens and flows are read from ("owner/repo on main"), or null for the built-in sample canvas. */
  canvas: string | null;
  appUrl: string; cron: boolean;
};

/**
 * Every outside service the demo touches: live, standing in with a built-in simulation, or missing (and how to fix it).
 * The demo's developer view only (its canvas and drafting rows describe the Celeste canvas and the Marver runner);
 * a customer app's Settings shows connectionRows instead.
 */
export function integrationRows(f: HealthFacts): HealthRow[] {
  const slackMissing = [!f.slack.token && "SLACK_BOT_TOKEN", !f.slack.signing && "SLACK_SIGNING_SECRET"].filter(Boolean) as string[];
  const publicUrl = f.appUrl.startsWith("https://");
  return [
    f.anthropic
      ? { name: "Claude", state: "Live", detail: "Splits feedback, scores it, names speakers, drafts proposals and follow-up questions." }
      : { name: "Claude", state: "Missing", detail: "New feedback, proposals and speaker names stop working.", fix: "Set ANTHROPIC_API_KEY." },
    f.voyage
      ? { name: "Embeddings", state: "Live", detail: "Voyage shortlists similar issues and screens before Claude decides." }
      : { name: "Embeddings", state: "Simulated", detail: "Claude picks from the full list of issues and screens, which is fine at this size.", fix: "Set VOYAGE_API_KEY for large projects." },
    f.deepgram
      ? { name: "Recordings", state: "Live", detail: "Deepgram transcribes recordings and tells speakers apart." }
      : { name: "Recordings", state: "Simulated", detail: "Only the bundled sample recordings can be read (their transcripts ship with the app).", fix: "Set DEEPGRAM_API_KEY." },
    slackMissing.length
      ? { name: "Slack", state: "Missing", detail: "No cards, alerts, digest or replies to reporters.", fix: `Set ${slackMissing.join(" and ")}.` }
      : !f.slack.inbox
        ? { name: "Slack", state: "Missing", detail: "The app is installed but its channels aren't set up.", fix: "Press Create channels in the Slack app card." }
        : { name: "Slack", state: "Live", detail: "Cards, threads, alerts, the daily digest and replies to reporters." },
    f.canvas
      ? { name: "Design canvas", state: "Live", detail: `Screens and flows are read from ${f.canvas}.` }
      : { name: "Design canvas", state: "Simulated", detail: "Screens and flows come from the built-in sample canvas.", fix: "Connect a repo under GitHub & Marver and set GITHUB_TOKEN." },
    f.drafting === "github"
      ? { name: "Design and drafting", state: "Live", detail: "Marver drafts mockups in GitHub Actions and opens pull requests." }
      : f.drafting === "mock"
        ? { name: "Design and drafting", state: "Simulated", detail: "The mock runner plays the GitHub Action: real dispatch, screenshot uploads and callback, with a simulated pull request.", fix: "Add github-template/pma-draft.yml to the design repo and remove DRAFT_BACKEND=mock." }
        : { name: "Design and drafting", state: "Simulated", detail: "The demo renderer draws schematic frames here.", fix: "Set DRAFT_BACKEND=mock to exercise the full contract, or connect a design repo and GITHUB_TOKEN." },
    publicUrl
      ? { name: "Public URL", state: "Live", detail: `Slack and GitHub call back to ${new URL(f.appUrl).host}.` }
      : { name: "Public URL", state: "Missing", detail: "Slack and GitHub can't reach this app.", fix: "Deploy it, or run a tunnel and set APP_URL to its https address." },
    f.cron
      ? { name: "Scheduled jobs", state: "Live", detail: "Retries and Slack catch-up once a day (Vercel Hobby); priority aging and the digest once a day." }
      : { name: "Scheduled jobs", state: "Missing", detail: "Failed feedback isn't retried and the digest never goes out.", fix: "Set CRON_SECRET (Vercel sends it to the cron routes)." },
  ];
}

export type ConnectionState = "Connected" | "Not connected" | "Beta" | "Live" | "Not seen yet" | "Missing";
export type ConnectionRow = { name: string; state: ConnectionState; detail: string };

/**
 * A customer app's repository and in-app widget, in plain words. Claude, Slack, Marver, PostHog and Granola have their
 * own Connect cards (src/components/connections/ToolCards.tsx).
 */
export function connectionRows(f: { repo: string | null; branch: string | null; widgetSources: number; widgetOrigins: number }): ConnectionRow[] {
  const origins = f.widgetOrigins ? ` It accepts ${f.widgetOrigins} allowed ${f.widgetOrigins === 1 ? "site" : "sites"}.` : "";
  return [
    f.repo
      // A repository name can end in "." (acme/Closet.), so a full stop never follows it directly.
      ? { name: "Repository", state: "Connected", detail: f.branch ? `Reading ${f.repo} on ${f.branch}. First steps cite its code.` : `First steps read the ${f.repo} repository and cite its code.` }
      : { name: "Repository", state: "Not connected", detail: "Connect it in the Repository card above, so first steps read your code." },
    f.widgetSources
      ? { name: "In-app widget", state: "Live", detail: `Feedback has arrived from the widget.${origins}` }
      : { name: "In-app widget", state: "Not seen yet", detail: `No feedback from the widget yet. Add its snippet (under Widget below) to your product.${origins}` },
  ];
}
