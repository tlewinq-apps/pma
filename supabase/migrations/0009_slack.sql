-- Slack app connector. Channel ids, one card thread per issue (with the activity cursor that drives sync), refs to
-- proposal/mockup messages so they can be edited in place, a Slack user -> member cache, and event-id dedupe.
-- Server-only: RLS on with no policies, and no table grants for anon/authenticated. Tokens live in env, not here.

create table public.slack_channels (
  project_id uuid not null references public.projects on delete cascade,
  role text not null check (role in ('inbox', 'bug', 'new_feature', 'add_on', 'streamline')),
  channel_id text not null unique,
  board_ts text,
  primary key (project_id, role)
);

create table public.slack_threads (
  issue_id uuid primary key references public.issues on delete cascade,
  channel_id text,
  ts text,
  cursor timestamptz,
  syncing_until timestamptz,
  unique (channel_id, ts)
);

create table public.slack_posts (
  ref text primary key,
  channel_id text not null,
  ts text not null
);

create table public.slack_users (
  slack_user_id text primary key,
  user_id uuid references auth.users on delete set null,
  email text,
  name text,
  checked_at timestamptz not null default now()
);

create table public.slack_events (
  event_id text primary key,
  at timestamptz not null default now()
);

alter table public.slack_channels enable row level security;
alter table public.slack_threads enable row level security;
alter table public.slack_posts enable row level security;
alter table public.slack_users enable row level security;
alter table public.slack_events enable row level security;
revoke all on table public.slack_channels, public.slack_threads, public.slack_posts, public.slack_users, public.slack_events from anon, authenticated;

-- One sync run per issue at a time: a 60 s lease, taken in a single upsert. Returns the row only to the caller that
-- now holds the lease; a concurrent caller gets no row and skips (the cron sweep picks up anything it missed).
create or replace function public.claim_slack_thread(p_issue uuid)
returns setof public.slack_threads
language sql
as $$
  insert into public.slack_threads as t (issue_id, syncing_until)
  values (p_issue, now() + interval '60 seconds')
  on conflict (issue_id) do update set syncing_until = now() + interval '60 seconds'
    where t.syncing_until is null or t.syncing_until < now()
  returning t.*;
$$;

-- project_member_emails() is scoped to the signed-in member; Slack handlers run as the service role.
create or replace function public.member_by_email(p_project uuid, p_email text)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.user_id from public.members m join auth.users u on u.id = m.user_id
  where m.project_id = p_project and lower(u.email) = lower(p_email)
  limit 1
$$;

create or replace function public.service_member_emails(p_project uuid)
returns table (user_id uuid, email text)
language sql stable security definer set search_path = ''
as $$
  select m.user_id, u.email::text from public.members m join auth.users u on u.id = m.user_id
  where m.project_id = p_project
$$;

revoke execute on function public.claim_slack_thread(uuid) from public, anon, authenticated;
grant execute on function public.claim_slack_thread(uuid) to service_role;
revoke execute on function public.member_by_email(uuid, text) from public, anon, authenticated;
grant execute on function public.member_by_email(uuid, text) to service_role;
revoke execute on function public.service_member_emails(uuid) from public, anon, authenticated;
grant execute on function public.service_member_emails(uuid) to service_role;
