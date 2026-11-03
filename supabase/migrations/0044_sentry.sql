-- Sentry: an app's Sentry project, connected with a personal token. Its unresolved errors become issue_signals (how
-- many people each one reached in 30 days, which a linked issue's urgency counts), errors can be linked to issues
-- like PostHog's, and the feedback people send through Sentry's User Feedback arrives as 'sentry' sources.

alter table public.connections drop constraint connections_kind_check;
alter table public.connections add constraint connections_kind_check
  check (kind in ('anthropic', 'github', 'slack', 'posthog', 'granola', 'marver', 'sentry'));

alter table public.issue_signals drop constraint issue_signals_provider_check;
alter table public.issue_signals add constraint issue_signals_provider_check check (provider in ('posthog', 'sentry'));
-- Where the signal lives in its tool (a Sentry issue's permalink), so a link made from it can open it.
alter table public.issue_signals add column url text check (url is null or url ~ '^https://');

alter table public.issue_links drop constraint issue_links_provider_check;
alter table public.issue_links add constraint issue_links_provider_check check (provider in ('posthog', 'sentry'));

alter table public.sources drop constraint if exists sources_kind_check;
alter table public.sources add constraint sources_kind_check
  check (kind in ('paste', 'file', 'widget', 'slack', 'granola', 'posthog', 'marver_comment', 'audio', 'sentry'));
