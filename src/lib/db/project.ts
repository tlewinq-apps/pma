// src/lib/db/project.ts
export interface Project {
  id: string; name: string; repo_full_name: string | null; design_path: string; watched_branch: string;
  slack_webhook_url: string | null; widget_key: string; widget_origins: string[]; route_map: Record<string, string>;
  score_weights: unknown; thresholds: unknown; allowed_domains: string[]; api_key: string;
  /** Settings > Alerts; parse with parseAlertRules. */
  alert_rules: unknown;
  /** The company that owns the app, and the app's slug in the URL (/[org]/[app]); `demo` apps are the sample ones. */
  org_id: string; slug: string; kind: "customer" | "demo";
  /** What the app is, in its own words (migration 0022); read it with profileOf. Written only by the server. */
  product_profile: unknown;
}
