// The Settings cards and Desk cards of a customer app against the demo's, rendered to HTML. The demo keeps its
// GitHub & Marver card, its legacy Slack webhook card and its parent words exactly; a customer app gets none of the
// retired instructions, the default alert size when nothing is saved, and the same audience words as the issue header.
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/components/app/AppContext", () => ({ useApp: () => ({ api: (p: string) => `/api/apps/x${p}`, href: (p: string) => `/acme/app${p}`, appId: "x", role: "owner" }) }));

import { SettingsForm, type SettingsView } from "@/app/(app)/[org]/[app]/settings/SettingsForm";
import { AlertsCard } from "@/app/(app)/[org]/[app]/settings/AlertsCard";
import { IssueCard } from "@/components/triage/IssueCard";
import { DEFAULT_ALERT_RULES, parseAlertRules } from "@/lib/alerts/rules";
import { DEMO_PROFILE, profileOf } from "@/lib/product/profile";
import type { IssueCardData } from "@/lib/queries/issues";

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

const view: SettingsView = {
  repo_full_name: "acme/app", design_path: "design", watched_branch: "main", slack_webhook_url: null,
  widget_key: "wk_1", widget_origins: [], route_map: {}, api_key_prefix: "abc123",
};
const HOOK = "https://hooks.slack.com/services/T000/B000/XXXX";
const settings = (demo: boolean, saved: string | null = null) =>
  renderToStaticMarkup(createElement(SettingsForm, { project: { ...view, slack_webhook_url: saved }, appUrl: "https://pma.test", demo }));
const headings = (html: string) => [...html.matchAll(/<h2[^>]*>([^<]+)/g)].map((m) => m[1].replace(/&amp;/g, "&"));

describe("SettingsForm", () => {
  it("keeps the demo's GitHub & Marver card, with the draft-workflow note, and its legacy Slack webhook card", () => {
    const html = settings(true);
    for (const heading of ["GitHub & Marver", "Widget", "Slack webhook (legacy)", "Use PMA from Claude"]) expect(text(html), heading).toContain(heading);
    expect(text(html)).toContain("Repository: acme/app. Connecting a repository moves to GitHub setup in a coming update.");
    expect(html).toContain('aria-label="Design path"');
    expect(html).toContain('aria-label="Watched branch"');
    expect(text(html)).toContain("Install the draft workflow: copy github-template/pma-draft.yml to .github/workflows/ in the repo and add secrets ANTHROPIC_API_KEY.");
    expect(text(html)).toContain("Not used while the Slack app above is connected.");
  });

  it("shows a customer app only the Widget and Use PMA from Claude cards: no old GitHub & Marver card, no retired workflow, no legacy webhook", () => {
    const html = settings(false);
    expect(headings(html)).toEqual(["Widget", "Use PMA from Claude"]);
    const t = text(html);
    expect(t).not.toMatch(/GitHub & Marver|github-template|pma-draft|draft workflow|\.github\/workflows|ANTHROPIC_API_KEY/i);
    expect(t).not.toMatch(/Slack webhook|legacy|Sync screens now|Not used while the Slack app/i);
    expect(html).not.toContain('aria-label="Design path"');
    expect(html).not.toContain('aria-label="Watched branch"');
    expect(html).not.toContain("hooks.slack.com");
    // The key's first characters only: the page never ships the key itself.
    expect(t).toContain("it starts abc123");
  });

  it("shows a customer app the legacy Slack webhook card only while it has a saved webhook, so it can be cleared", () => {
    const html = settings(false, HOOK);
    expect(headings(html)).toEqual(["Widget", "Slack webhook (legacy)", "Use PMA from Claude"]);
    expect(html).toContain(`value="${HOOK}"`);
    expect(html).toContain('name="hook"');
    expect(text(html)).toContain("Clear the address and save to remove it; Slack under Connections replaces it.");
    // Its own wording: nothing points at a Slack app card the customer app doesn't have.
    expect(text(html)).not.toMatch(/Slack app above/);
    // Still no GitHub & Marver card or retired instructions.
    expect(text(html)).not.toMatch(/GitHub & Marver|github-template|ANTHROPIC_API_KEY|Sync screens now/i);
    // A cleared webhook (null or an empty string) takes the card away again.
    for (const cleared of [null, ""]) expect(headings(settings(false, cleared)), JSON.stringify(cleared)).toEqual(["Widget", "Use PMA from Claude"]);
  });

  it("keeps the demo's webhook card whether or not a webhook is saved, with its own words", () => {
    for (const saved of [null, HOOK]) {
      const html = settings(true, saved);
      expect(headings(html), String(saved)).toEqual(["GitHub & Marver", "Widget", "Slack webhook (legacy)", "Use PMA from Claude"]);
      expect(text(html)).toContain("Posts quick-win alerts to one channel. Not used while the Slack app above is connected.");
      expect(text(html)).not.toContain("Clear the address");
    }
    expect(settings(true, HOOK)).toContain(`value="${HOOK}"`);
  });
});

const jumpPoints = (html: string) => html.match(/<input[^>]*aria-label="Points"[^>]*>/)?.[0].match(/value="(\d+)"/)?.[1];
const alerts = (initial: Parameters<typeof AlertsCard>[0]["initial"], extra: { slackLive?: boolean; customer?: boolean } = {}) =>
  renderToStaticMarkup(createElement(AlertsCard, { initial, members: [], slackLive: false, inboxChannel: null, ...extra }));

describe("AlertsCard", () => {
  it("fills the sudden-jump size with the default for an app that saved no alert rules", () => {
    expect(DEFAULT_ALERT_RULES.jump.points).toBe(15);
    // projects.alert_rules is '{}' until the first save (migration 0012), and a null or malformed value reads the same.
    for (const saved of [{}, null, undefined, "x", { jump: {} }, { jump: { enabled: true } }, { jump: { points: "lots" } }]) {
      expect(jumpPoints(alerts(parseAlertRules(saved))), JSON.stringify(saved)).toBe("15");
    }
  });

  it("fills it even when handed a rules object with no number in it", () => {
    expect(jumpPoints(alerts({ recipients: [], blockingBug: true, jump: { enabled: true } as never, digest: { enabled: true } }))).toBe("15");
    expect(jumpPoints(alerts({} as never))).toBe("15");
  });

  it("keeps a saved size, as the demo's 8", () => {
    expect(jumpPoints(alerts(parseAlertRules({ jump: { enabled: true, points: 8 } })))).toBe("8");
    expect(text(alerts(parseAlertRules({ jump: { enabled: true, points: 8 } })))).toContain("A sudden jump: priority rises points or more in a day");
  });

  it("points a customer app at Connections for Slack, and leaves the demo's wording as it was", () => {
    const customer = text(alerts(DEFAULT_ALERT_RULES, { customer: true }));
    expect(customer).toContain("Connect Slack under Connections to send them; until then alerts only show in each issue's activity.");
    expect(customer).not.toContain("Slack app above");
    expect(text(alerts(DEFAULT_ALERT_RULES))).toContain("Set up the Slack app above to send them; until then alerts only show in each issue's activity.");
    expect(text(alerts(DEFAULT_ALERT_RULES, { customer: true, slackLive: true }))).not.toMatch(/until then alerts only show/);
  });
});

const issue: IssueCardData = {
  id: "i1", short_id: "a", title: "Generated image overflows viewing box", type: "bug", lane: "quick_win", importance: 60, ease: 60,
  people_count: 1, status: "new", owner: null, flow: null, mean_sentiment: 0, emotion: null, scope: null, severity: 3,
  urgency: null, urgency_raw: null, diagnosis: null, seen_by: [], top_quotes: [], proposal: { count: 0, title: null }, draft: null,
  job_code: null, audiences: ["users"], last_activity_at: "2026-10-15T11:00:00Z", approved_at: null,
};
const card = (o: Partial<IssueCardData>, profile?: Parameters<typeof IssueCard>[0]["profile"]) =>
  text(renderToStaticMarkup(createElement(IssueCard, { issue: { ...issue, ...o }, href: "/acme/app/issues/i1", rail: 0, pos: 0, profile })));

describe("the Desk card's people", () => {
  const closet = profileOf({ kind: "customer", name: "Closet", product_profile: { name: "Closet", one_liner: "an AI fashion app", audience: "shoppers", audience_one: "shopper", platform: "web" } });
  const undescribed = profileOf({ kind: "customer", name: "Closet", product_profile: null });

  it("uses the app's audience words, the same as the issue header", () => {
    expect(card({ people_count: 1 }, closet)).toContain("1 shopper");
    expect(card({ people_count: 3 }, closet)).toContain("3 shoppers");
    expect(card({ people_count: 1 }, closet)).not.toMatch(/1 person/);
  });

  it("says person and people for an app that isn't described yet", () => {
    expect(card({ people_count: 1 }, undescribed)).toContain("1 person");
    expect(card({ people_count: 2 }, undescribed)).toContain("2 people");
  });

  it("counts a staff-only issue as staff, as the header does", () => {
    expect(card({ people_count: 2, audiences: ["staff"] }, closet)).toContain("2 staff members");
  });

  it("keeps the card plain without a profile: person and people, whatever the audience", () => {
    expect(card({ people_count: 1, audiences: ["parents"] })).toContain("1 person");
    expect(card({ people_count: 2, audiences: ["parents"] })).toContain("2 people");
    expect(card({ people_count: 1, audiences: ["parents"] }, null)).toContain("1 person");
    // The demo's header says "1 member"; a card without a profile keeps "1 person".
    expect(DEMO_PROFILE.audience_one).toBe("member");
  });
});
