import { parseAlertRules, type AlertRules } from "@/lib/alerts/rules";

export type SettingsPatch = Partial<{
  design_path: string; watched_branch: string; slack_webhook_url: string | null;
  widget_origins: string[]; route_map: Record<string, string>; alert_rules: AlertRules;
}>;

export const REPO_IN_GITHUB_SETUP = "The repository is connected through GitHub setup.";

const SAFE_PATH = /^[A-Za-z0-9._/-]+$/;
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** A branch name PMA accepts: letters, digits, . _ - and /, with no "..", no leading or trailing slash, not *.lock. */
export function isBranchName(v: unknown): v is string {
  return typeof v === "string" && SAFE_PATH.test(v) && !v.includes("..") && !v.startsWith("/") && !v.endsWith("/") && !v.endsWith(".lock");
}

export function parseSettingsPatch(body: unknown): { patch: SettingsPatch } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Body must be a JSON object" };
  const b = body as Record<string, unknown>;
  const patch: SettingsPatch = {};
  // Sign-in no longer checks email domains; the allowed_domains column is kept until a later migration drops it, but
  // nothing writes it.
  if ("allowed_domains" in b) return { error: "That setting is gone." };

  // Signed-in users can't update projects.repo_full_name (0018 grants no UPDATE on it): which repo an app drafts into
  // decides where the GitHub token writes. It is set only through POST /api/apps/[appId]/repo (owners and admins, after
  // the repo is read). Refused here with a sentence, before the database would refuse the whole save.
  if ("repo_full_name" in b) return { error: REPO_IN_GITHUB_SETUP };
  if ("design_path" in b) {
    const v = b.design_path;
    if (typeof v !== "string" || !SAFE_PATH.test(v) || v.startsWith("/") || v.split("/").includes("..")) return { error: "design_path must be a relative repo path (letters, digits, . _ - /) without .." };
    patch.design_path = v;
  }
  if ("watched_branch" in b) {
    const v = b.watched_branch;
    if (!isBranchName(v)) return { error: "Invalid branch name" };
    patch.watched_branch = v;
  }
  if ("slack_webhook_url" in b) {
    const v = b.slack_webhook_url;
    if (v === null || v === "") patch.slack_webhook_url = null;
    else if (typeof v === "string" && v.startsWith("https://hooks.slack.com/")) patch.slack_webhook_url = v;
    else return { error: "Slack webhook must start with https://hooks.slack.com/" };
  }
  if ("widget_origins" in b) {
    if (!isStringArray(b.widget_origins)) return { error: "widget_origins must be an array of strings" };
    const origins: string[] = [];
    for (const s of b.widget_origins) {
      let u: URL;
      try { u = new URL(s); } catch { return { error: `Invalid origin: ${s}` }; }
      if (u.protocol !== "http:" && u.protocol !== "https:") return { error: `Origin must be http(s): ${s}` };
      origins.push(u.origin);
    }
    patch.widget_origins = origins;
  }
  if ("route_map" in b) {
    const m = b.route_map;
    if (!m || typeof m !== "object" || Array.isArray(m) || !Object.values(m).every((v) => typeof v === "string")) return { error: "route_map must be an object of strings" };
    patch.route_map = m as Record<string, string>;
  }
  if ("alert_rules" in b) {
    if (!b.alert_rules || typeof b.alert_rules !== "object" || Array.isArray(b.alert_rules)) return { error: "alert_rules must be an object" };
    patch.alert_rules = parseAlertRules(b.alert_rules);
  }
  if (Object.keys(patch).length === 0) return { error: "No valid fields to update" };
  return { patch };
}
