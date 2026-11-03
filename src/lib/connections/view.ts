// What the Connect cards on Start here and Settings show for an app: one entry per tool, with its state in plain
// words (Connected, Needs attention, Not connected), what's connected, and what the next step is. Built on the server
// with the service role after requireApp has checked the viewer is in the company; it never carries a secret, a token
// or a config value a member shouldn't see.
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "@/lib/db/server";
import { env, slackOAuthEnabled } from "@/lib/env";
import { fallbackAllowed } from "./claude";
import type { Connection, ConnectionKind } from "./store";
import { parsePosthogConfig } from "@/lib/posthog/connection";
import type { PostHogProject, Region } from "@/lib/posthog/client";
import { parseGranolaConfig } from "@/lib/granola/notes";
import { parseSentryConfig } from "@/lib/sentry/connection";
import { slackStatus, type SlackStatus } from "@/lib/slack/setup";

export type ToolKey = "claude" | "slack" | "marver" | "posthog" | "sentry" | "granola";
export type ToolState = "connected" | "attention" | "off";

export type ToolCard =
  | { tool: "claude"; state: ToolState; reason: string | null; last4: string | null; sharedFallback: boolean }
  | { tool: "slack"; state: ToolState; reason: string | null; offered: boolean; reachable: boolean; team: string | null; channels: SlackStatus["channels"]; needsChannels: boolean; prefix: string; error: string | null }
  | { tool: "marver"; state: ToolState; reason: string | null; repo: string | null; path: string | null; screens: number | null; flows: number | null; appRepo: string | null }
  | { tool: "posthog"; state: ToolState; reason: string | null; region: Region | null; project: string | null; auth: "oauth" | "key" | null; pick: PostHogProject[] | null; lastSync: string | null }
  | { tool: "sentry"; state: ToolState; reason: string | null; org: string | null; project: string | null; selfHosted: boolean; pick: { key: string; label: string }[] | null; lastSync: string | null }
  | { tool: "granola"; state: ToolState; reason: string | null; last4: string | null; webhook: boolean; here: boolean; target: string | null; lastSync: string | null };

/** ok is Connected; broken or revoked Needs attention; nothing, pending or disconnected is Not connected. */
export function stateOf(c: Pick<Connection, "status"> | null | undefined): ToolState {
  if (!c) return "off";
  if (c.status === "ok") return "connected";
  if (c.status === "broken" || c.status === "revoked") return "attention";
  return "off";
}

type App = { id: string; org_id: string; slug: string; name: string; repo_full_name: string | null; kind: string };

/** Every tool card for this app, in the order Start here shows them. */
export async function toolCards(app: App, db: SupabaseClient = serviceDb()): Promise<ToolCard[]> {
  const [{ data }, { data: org }] = await Promise.all([
    db.from("connections").select("id, org_id, project_id, kind, status, status_reason, display, config, updated_at, verified_at")
      .eq("org_id", app.org_id).or(`project_id.is.null,project_id.eq.${app.id}`),
    db.from("organizations").select("self_serve").eq("id", app.org_id).maybeSingle(),
  ]);
  const rows = (data ?? []) as Connection[];
  const pick = (kind: ConnectionKind) => rows.find((r) => r.kind === kind) ?? null;
  const reason = (c: Connection | null) => (c && stateOf(c) === "attention" ? c.status_reason ?? "Connect it again." : null);
  const s = (v: unknown) => (typeof v === "string" ? v : null);
  const n = (v: unknown) => (typeof v === "number" ? v : null);

  const claude = pick("anthropic");
  const slack = pick("slack");
  const slackView = await slackStatus(app.id).catch(() => null);
  let slackState = stateOf(slack);
  if (slackState === "connected" && !(slackView?.channels.some((c) => c.role === "inbox"))) slackState = "attention";

  const marver = pick("marver");
  const posthog = pick("posthog");
  const ph = parsePosthogConfig(posthog?.config);
  const phPick = posthog?.status === "pending" && ph?.projects?.length ? ph.projects : null;
  const sentry = pick("sentry");
  const sc = parseSentryConfig(sentry?.config);
  const scPick = sentry?.status === "pending" && sc?.projects?.length ? sc.projects.map(({ key, label }) => ({ key, label })) : null;
  const granola = pick("granola");
  const gc = parseGranolaConfig(granola?.config);
  let target: string | null = null;
  if (granola && gc.default_project_id && gc.default_project_id !== app.id) {
    const { data: t } = await db.from("projects").select("name").eq("id", gc.default_project_id).eq("org_id", app.org_id).maybeSingle();
    target = (t?.name as string | undefined) ?? null;
  }

  return [
    { tool: "claude", state: stateOf(claude), reason: reason(claude), last4: claude?.status === "ok" ? s(claude.display.last4) : null, sharedFallback: fallbackAllowed(org) && !!process.env.ANTHROPIC_API_KEY },
    {
      tool: "slack", state: slackState, reason: slackState === "attention" && slack?.status === "ok" ? "Pick or create the two channels to finish." : reason(slack),
      offered: slackOAuthEnabled(), reachable: slackView?.via === "installation", team: slackView?.team ?? s(slack?.display.team), channels: slackView?.channels ?? [],
      needsChannels: slack?.status === "ok" && !(slackView?.channels.length), prefix: app.slug, error: slackView?.error ?? null,
    },
    {
      tool: "marver", state: stateOf(marver), reason: reason(marver), repo: s(marver?.display.repo), path: s(marver?.display.path),
      screens: n(marver?.display.screens), flows: n(marver?.display.flows), appRepo: app.repo_full_name,
    },
    {
      tool: "posthog", state: phPick ? "attention" : stateOf(posthog), reason: phPick ? "Pick the PostHog project for this app to finish." : reason(posthog),
      region: ph?.region ?? null, project: ph?.project_name ?? null, auth: ph?.auth ?? null, pick: phPick, lastSync: ph?.last_sync_at ?? null,
    },
    {
      tool: "sentry", state: scPick ? "attention" : stateOf(sentry), reason: scPick ? "Pick the Sentry project for this app to finish." : reason(sentry),
      org: sc?.org_name ?? null, project: sc?.project_name ?? null, selfHosted: !!sc && sc.base_url !== "https://sentry.io", pick: scPick, lastSync: sc?.last_sync_at ?? null,
    },
    {
      tool: "granola", state: stateOf(granola), reason: reason(granola), last4: granola?.status === "ok" ? s(granola.display.last4) : null,
      webhook: !!granola?.display.webhook, here: !gc.default_project_id || gc.default_project_id === app.id, target, lastSync: gc.last_sync_at,
    },
  ];
}

/** Whether a public https address exists for webhooks and OAuth (dev on localhost has none). */
export const publicUrl = () => env.appUrl().startsWith("https://");
