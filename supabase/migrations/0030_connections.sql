-- Each company connects its own outside tools: its Claude key, its Slack workspace, its Granola workspace, and per app
-- a PostHog project and a Marver canvas. Nothing is shared across companies.
--
-- connections: one row per tool per company (project_id null) or per app. `display` is what members see (team name,
-- last 4 characters, project name) and `config` is what the server needs (ids, hosts, cursors); neither ever holds a
-- secret. The secret itself (an API key, a bot token, an OAuth token pair, a webhook signing secret) lives in Supabase
-- Vault, and connections.secret_id points at it. Only the service role reads or writes secrets, through
-- connection_secret_set / _get / _drop; members see status through connection_status(app).
--
-- oauth_states: one row per OAuth hand-off in flight (Slack, PostHog). The raw state never touches the database, only
-- its sha256, and the row is deleted when the callback uses it. code_verifier is the PKCE verifier for PostHog.
--
-- audit_log: who connected, disconnected or lost a connection, readable by the company's owners and admins.
--
-- Slack becomes one distributed app installed per workspace: slack_installations maps a workspace (team_id) to the one
-- company that installed it, slack_posts gains the app in its key, slack_users the workspace in its key, and an app's
-- channels are an inbox and a cards channel (the demo keeps its five legacy channels).

-- ---------------------------------------------------------------------------------------------------------------------
-- Connections
-- ---------------------------------------------------------------------------------------------------------------------

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations on delete cascade,
  project_id uuid references public.projects on delete cascade,
  kind text not null check (kind in ('anthropic', 'github', 'slack', 'posthog', 'granola', 'marver')),
  status text not null default 'pending' check (status in ('pending', 'ok', 'broken', 'revoked', 'disconnected')),
  status_reason text,
  display jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  external_id text,
  secret_id uuid,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  verified_at timestamptz
);
-- One row per tool per company, and per tool per app. Disconnecting keeps the row (status 'disconnected', secret
-- dropped); connecting again reuses it.
create unique index connections_scope on public.connections
  (org_id, kind, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index connections_project_id on public.connections (project_id) where project_id is not null;
-- An app-level connection belongs to an app of the same company.
create or replace function public.connections_same_company() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.project_id is not null and not exists (select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id) then
    raise exception 'connection app belongs to another company';
  end if;
  return new;
end $$;
create trigger connections_same_company before insert or update of org_id, project_id on public.connections
  for each row execute function public.connections_same_company();

-- A deleted connection (or its company or app) takes its Vault secret with it.
create or replace function public.connections_drop_secret() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.secret_id is not null then delete from vault.secrets where id = old.secret_id; end if;
  return old;
end $$;
create trigger connections_drop_secret after delete on public.connections
  for each row execute function public.connections_drop_secret();

-- Stores (or replaces) the connection's secret in Vault. Service role only.
create or replace function public.connection_secret_set(p_connection uuid, p_secret text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if coalesce(p_secret, '') = '' then raise exception 'empty_secret'; end if;
  select c.secret_id into v_id from public.connections c where c.id = p_connection for update;
  if not found then raise exception 'connection_not_found'; end if;
  if v_id is not null and exists (select 1 from vault.secrets s where s.id = v_id) then
    perform vault.update_secret(v_id, p_secret);
  else
    v_id := vault.create_secret(p_secret, 'connection:' || p_connection::text || ':' || gen_random_uuid()::text, 'PMA connection secret');
    update public.connections set secret_id = v_id, updated_at = now() where id = p_connection;
  end if;
end $$;

-- The connection's secret, or null. Service role only.
create or replace function public.connection_secret_get(p_connection uuid) returns text
language sql stable security definer set search_path = '' as $$
  select s.decrypted_secret from public.connections c join vault.decrypted_secrets s on s.id = c.secret_id where c.id = p_connection
$$;

-- Forgets the connection's secret. Service role only.
create or replace function public.connection_secret_drop(p_connection uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  select c.secret_id into v_id from public.connections c where c.id = p_connection for update;
  update public.connections set secret_id = null, updated_at = now() where id = p_connection;
  if v_id is not null then delete from vault.secrets where id = v_id; end if;
end $$;

-- What members of a company see about an app's connections: the company-level ones and the app's own, with status and
-- the display fields. Never config, external ids or secrets.
create or replace function public.connection_status(p_project uuid)
returns table (kind text, scope text, status text, status_reason text, display jsonb, updated_at timestamptz, verified_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.kind, case when c.project_id is null then 'company' else 'app' end, c.status, c.status_reason, c.display, c.updated_at, c.verified_at
    from public.projects p
    join public.connections c on c.org_id = p.org_id and (c.project_id is null or c.project_id = p.id)
   where p.id = p_project and public.is_member(p_project)
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- OAuth hand-offs and the audit log
-- ---------------------------------------------------------------------------------------------------------------------

create table public.oauth_states (
  state_hash text primary key,
  provider text not null check (provider in ('slack', 'posthog')),
  org_id uuid not null references public.organizations on delete cascade,
  project_id uuid references public.projects on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  code_verifier text,
  return_to text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index oauth_states_expires_at on public.oauth_states (expires_at);

create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations on delete cascade,
  project_id uuid references public.projects on delete set null,
  actor_id uuid references auth.users on delete set null,
  action text not null,
  target text,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index audit_log_org_at on public.audit_log (org_id, at desc);

-- ---------------------------------------------------------------------------------------------------------------------
-- Slack: one installation per workspace, one workspace per company
-- ---------------------------------------------------------------------------------------------------------------------

create table public.slack_installations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations on delete cascade,
  connection_id uuid not null references public.connections on delete cascade,
  team_id text not null,
  team_name text,
  team_url text,
  enterprise_id text,
  app_id text,
  bot_user_id text,
  scopes text[] not null default '{}',
  installed_by uuid references auth.users on delete set null,
  status text not null default 'active' check (status in ('active', 'revoked', 'disconnected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);
-- A workspace connects to one company at a time, and a company to one workspace.
create unique index slack_installations_team_active on public.slack_installations (team_id) where status = 'active';
create unique index slack_installations_org_active on public.slack_installations (org_id) where status = 'active';
create index slack_installations_connection_id on public.slack_installations (connection_id);

-- An app's channels: the inbox (feedback in) and the cards channel (one card per issue, its thread, the pinned board).
-- The per-type roles stay for the demo's legacy channels.
alter table public.slack_channels drop constraint if exists slack_channels_role_check;
alter table public.slack_channels add constraint slack_channels_role_check
  check (role in ('inbox', 'cards', 'bug', 'new_feature', 'add_on', 'streamline'));

-- Message refs belong to an app. Existing refs are matched to the app that holds their channel, then by the issue or
-- source id inside the ref; anything left is an orphan ref (the message is simply posted again if it's needed).
alter table public.slack_posts add column project_id uuid references public.projects on delete cascade;
update public.slack_posts sp set project_id = c.project_id from public.slack_channels c where c.channel_id = sp.channel_id and sp.project_id is null;
update public.slack_posts sp set project_id = i.project_id from public.issues i
 where sp.project_id is null and split_part(sp.ref, ':', 1) in ('proposals', 'draft', 'flow', 'solution')
   and split_part(sp.ref, ':', 2) ~ '^[0-9a-f-]{36}$' and i.id = split_part(sp.ref, ':', 2)::uuid;
update public.slack_posts sp set project_id = i.project_id from public.issues i
 where sp.project_id is null and sp.ref like 'closed:draft:%'
   and split_part(sp.ref, ':', 3) ~ '^[0-9a-f-]{36}$' and i.id = split_part(sp.ref, ':', 3)::uuid;
update public.slack_posts sp set project_id = s.project_id from public.sources s
 where sp.project_id is null and sp.ref like 'source:%'
   and split_part(sp.ref, ':', 2) ~ '^[0-9a-f-]{36}$' and s.id = split_part(sp.ref, ':', 2)::uuid;
delete from public.slack_posts where project_id is null;
alter table public.slack_posts alter column project_id set not null;
alter table public.slack_posts drop constraint slack_posts_pkey;
alter table public.slack_posts add primary key (project_id, ref);

-- Slack people are per workspace. Rows from the deployment's original workspace (the demo's env token) keep team ''.
alter table public.slack_users add column team_id text not null default '';
alter table public.slack_users drop constraint slack_users_pkey;
alter table public.slack_users add primary key (team_id, slack_user_id);

-- ---------------------------------------------------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------------------------------------------------

-- Server only: members read connections through connection_status(), never the table.
alter table public.connections enable row level security;
alter table public.oauth_states enable row level security;
alter table public.slack_installations enable row level security;
revoke all on table public.connections, public.oauth_states, public.slack_installations from anon, authenticated;

alter table public.audit_log enable row level security;
create policy admin_read on public.audit_log for select to authenticated using (public.has_org_role(org_id, '{owner,admin}'));
revoke all on table public.audit_log from anon, authenticated;
grant select on table public.audit_log to authenticated;

-- Supabase grants new functions to anon, authenticated and service_role directly, so "from public" alone is not enough.
revoke all on function public.connection_secret_set(uuid, text), public.connection_secret_get(uuid), public.connection_secret_drop(uuid)
  from public, anon, authenticated;
grant execute on function public.connection_secret_set(uuid, text), public.connection_secret_get(uuid), public.connection_secret_drop(uuid)
  to service_role;
revoke all on function public.connection_status(uuid) from public, anon;
grant execute on function public.connection_status(uuid) to authenticated, service_role;
revoke all on function public.connections_same_company(), public.connections_drop_secret() from public, anon, authenticated;

notify pgrst, 'reload schema';
