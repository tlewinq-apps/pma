-- What connected tools say about an app's issues.
--
-- issue_signals: counts from PostHog, refreshed by the posthog_sync job (one HogQL query per kind, 30 days):
--   exception  key = PostHog's error issue id ($exception_issue_id), issue_id = the PMA issue it is linked to
--   rageclick  key = $pathname
--   pageview   key = $pathname
-- Pathname rows have no issue; they reach an issue through the app's screens (route_map). Written by the server only.
--
-- issue_links: a PostHog error tied to a PMA issue. PMA suggests matches; a member confirms one, and anyone in
-- the company can link or unlink. The issue and the link always belong to the same app.

create table public.issue_signals (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects on delete cascade,
  issue_id uuid references public.issues on delete set null,
  provider text not null default 'posthog' check (provider in ('posthog')),
  kind text not null check (kind in ('exception', 'rageclick', 'pageview')),
  key text not null,
  label text,
  users_30d int not null default 0,
  events_30d int not null default 0,
  last_seen_at timestamptz,
  refreshed_at timestamptz not null default now(),
  unique (project_id, provider, kind, key)
);
create index issue_signals_issue_id on public.issue_signals (issue_id) where issue_id is not null;

create table public.issue_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  issue_id uuid not null references public.issues on delete cascade,
  provider text not null check (provider in ('posthog')),
  kind text not null default 'error' check (kind in ('error')),
  external_id text not null check (length(external_id) between 1 and 200),
  title text check (title is null or length(title) <= 500),
  url text check (url is null or url ~ '^https://'),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  unique (issue_id, provider, external_id)
);
create index issue_links_project_external on public.issue_links (project_id, provider, external_id);

alter table public.issue_signals enable row level security;
create policy member_read on public.issue_signals for select to authenticated using (public.is_member(project_id));
revoke all on table public.issue_signals from anon, authenticated;
grant select on table public.issue_signals to authenticated;

alter table public.issue_links enable row level security;
create policy member_read on public.issue_links for select to authenticated using (public.is_member(project_id));
create policy member_insert on public.issue_links for insert to authenticated
  with check (public.is_member(project_id)
              and exists (select 1 from public.issues i where i.id = issue_id and i.project_id = issue_links.project_id)
              and created_by = (select auth.uid()));
create policy member_delete on public.issue_links for delete to authenticated using (public.is_member(project_id));
revoke all on table public.issue_links from anon, authenticated;
grant select, insert, delete on table public.issue_links to authenticated;

notify pgrst, 'reload schema';
