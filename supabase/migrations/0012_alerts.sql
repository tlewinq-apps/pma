-- Slack alerts: who gets them and which events count (Settings > Alerts), plus a send log whose unique key makes
-- each alert go out once even when two rescores or cron runs race (src/lib/alerts/send.ts claimAlert).
alter table public.projects add column if not exists alert_rules jsonb not null default '{}'::jsonb;

create table if not exists public.alert_log (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects on delete cascade,
  issue_id uuid references public.issues on delete cascade,
  rule text not null,
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz not null default now(),
  unique (project_id, dedupe_key)
);

-- Server-only, like the Slack tables: RLS on with no policies, and no table grants for anon/authenticated.
alter table public.alert_log enable row level security;
revoke all on table public.alert_log from anon, authenticated;
