-- Companies above apps. A company (organizations) owns apps (projects, one row per app) and has members with a role
-- (org_members: owner | admin | member). public.is_member(p) now means "the signed-in user is in the company that
-- owns app p", so every existing policy that calls it (0001_init, 0016_marver_frames) moves to company membership
-- without being rewritten.
--
-- Platform admins (platform_admins) never see inside a company: is_member() has no bypass, and
-- admin_company_summaries() returns names, slugs, dates and counts only.
--
-- Invite only. A company is created from a company invite (create_org_from_invite) and joined from a member invite
-- (accept_member_invite). Raw tokens are never stored: token_hash = encode(extensions.digest(token, 'sha256'), 'hex'),
-- which TypeScript computes as createHash("sha256").update(token).digest("hex").
--
-- The RPCs raise exceptions whose message is the reason code the app shows as copy (invite_used, invite_expired,
-- invite_revoked, invite_not_found, invite_email, slug_reserved, slug_invalid, slug_taken, last_owner, forbidden).
--
-- Kept for now: projects.allowed_domains and the members table. Running production code reads them until the
-- company-aware app is deployed; a later migration drops them.

create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug extensions.citext not null unique,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.org_members (
  org_id uuid not null references public.organizations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user_id on public.org_members (user_id);

create table public.platform_admins (
  user_id uuid primary key references auth.users on delete cascade
);

-- Made by a platform admin on /admin. email null: anyone holding the link; set: only that address may use it.
-- org_id is the company the invite created, once consumed.
create table public.company_invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  email extensions.citext,
  note text,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_by uuid references auth.users on delete set null,
  consumed_at timestamptz,
  org_id uuid references public.organizations on delete set null,
  revoked_at timestamptz
);

-- Made by a company owner or admin (invite_member) for one address.
create table public.member_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations on delete cascade,
  email extensions.citext not null,
  role text not null check (role in ('admin', 'member')),
  token_hash text not null unique,
  invited_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_by uuid references auth.users on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz
);
create index member_invites_org_id on public.member_invites (org_id);
-- One pending invite per address per company. An expired one still counts until replaced: invite_member revokes it.
create unique index member_invites_pending on public.member_invites (org_id, email)
  where accepted_at is null and revoked_at is null;

-- A signed-out person who opened a company invite and asked for a sign-in email. While the claim is unexpired, the
-- before-user-created auth hook lets that address sign up.
create table public.invite_claims (
  email extensions.citext primary key,
  company_invite_id uuid not null references public.company_invites on delete cascade,
  expires_at timestamptz not null
);
create index invite_claims_company_invite_id on public.invite_claims (company_invite_id);

alter table public.projects
  add column org_id uuid references public.organizations on delete cascade,
  add column slug extensions.citext,
  add column kind text not null default 'customer' check (kind in ('customer', 'demo'));
create unique index projects_org_id_slug on public.projects (org_id, slug);

-- ---------------------------------------------------------------------------------------------------------------------
-- Access checks, used by RLS policies as the signed-in user
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function public.is_org_member(o uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.org_members where org_id = o and user_id = (select auth.uid()))
$$;

create or replace function public.has_org_role(o uuid, roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.org_members
                where org_id = o and user_id = (select auth.uid()) and role = any (roles))
$$;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.platform_admins where user_id = (select auth.uid()))
$$;

-- Same name and signature as 0001_init, so every policy that calls it now checks company membership.
create or replace function public.is_member(p uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.projects pr join public.org_members m on m.org_id = pr.org_id
                where pr.id = p and m.user_id = (select auth.uid()))
$$;

-- Member emails: same names and signatures as 0004 and 0009 (no TypeScript caller changes), now everyone in the
-- company that owns the app.
create or replace function public.project_member_emails(p_project uuid) returns table (user_id uuid, email text)
language sql stable security definer set search_path = '' as $$
  select m.user_id, u.email::text
    from public.projects pr
    join public.org_members m on m.org_id = pr.org_id
    join auth.users u on u.id = m.user_id
   where pr.id = p_project and public.is_member(p_project)
$$;

create or replace function public.member_by_email(p_project uuid, p_email text)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.user_id
    from public.projects pr
    join public.org_members m on m.org_id = pr.org_id
    join auth.users u on u.id = m.user_id
   where pr.id = p_project and lower(u.email) = lower(p_email)
   limit 1
$$;

create or replace function public.service_member_emails(p_project uuid)
returns table (user_id uuid, email text)
language sql stable security definer set search_path = ''
as $$
  select m.user_id, u.email::text
    from public.projects pr
    join public.org_members m on m.org_id = pr.org_id
    join auth.users u on u.id = m.user_id
   where pr.id = p_project
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Slugs
-- ---------------------------------------------------------------------------------------------------------------------

-- Reserved slugs and the slug pattern for company and app slugs: an exact copy of src/lib/links.ts (RESERVED_SLUGS,
-- SLUG_PATTERN, slugProblem), reserved checked first. Change both together; tests/unit/slugParity.test.ts fails if they
-- drift. Returns 'slug_reserved', 'slug_invalid' or null.
create or replace function public.slug_problem(p_slug text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_slug = any (array['sign-in', 'auth', 'api', 'admin', 'invite', 'join', 'onboarding', 'welcome',
                             'issues', 'feedback', 'flows', 'projects', 'work', 'settings', 'mock',
                             'widget.js', '_next', 'favicon.ico', 'icon.svg', 'no-company', 'apps']) then 'slug_reserved'
    when p_slug is null or p_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$' then 'slug_invalid'
  end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Invites and companies
-- ---------------------------------------------------------------------------------------------------------------------

-- The signed-in user creates their company and its first app from a company invite, and becomes its owner.
-- The invite is checked before the slugs, so a bad link cannot be used to probe which slugs are taken. The invite row
-- is locked, so two tabs racing on one link cannot both consume it.
create or replace function public.create_org_from_invite(p_token text, p_org_name text, p_org_slug text, p_app_name text, p_app_slug text)
returns table (org_slug text, app_slug text)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_inv public.company_invites%rowtype;
  v_org uuid;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  select u.email::text into v_email from auth.users u where u.id = v_uid;

  select * into v_inv from public.company_invites i
   where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
   for update;
  if not found then raise exception 'invite_not_found'; end if;
  if v_inv.consumed_at is not null then raise exception 'invite_used'; end if;
  if v_inv.revoked_at is not null then raise exception 'invite_revoked'; end if;
  if v_inv.expires_at <= now() then raise exception 'invite_expired'; end if;
  if v_inv.email is not null and lower(v_inv.email::text) is distinct from lower(v_email) then
    raise exception 'invite_email';
  end if;

  -- Company slugs are unique across PMA; app slugs are unique within their company. Valid slugs are lowercase, so
  -- comparing lower(slug) finds a taken one whatever its stored case.
  if public.slug_problem(p_org_slug) is not null then raise exception '%', public.slug_problem(p_org_slug); end if;
  if exists (select 1 from public.organizations o where lower(o.slug::text) = p_org_slug) then
    raise exception 'slug_taken';
  end if;
  if public.slug_problem(p_app_slug) is not null then raise exception '%', public.slug_problem(p_app_slug); end if;

  begin
    insert into public.organizations (name, slug, created_by)
    values (coalesce(nullif(btrim(p_org_name), ''), p_org_slug), p_org_slug, v_uid)
    returning id into v_org;
  exception when unique_violation then
    raise exception 'slug_taken'; -- taken between the check above and this insert
  end;
  insert into public.org_members (org_id, user_id, role) values (v_org, v_uid, 'owner');

  if exists (select 1 from public.projects pr where pr.org_id = v_org and lower(pr.slug::text) = p_app_slug) then
    raise exception 'slug_taken';
  end if;
  insert into public.projects (org_id, name, slug, kind)
  values (v_org, coalesce(nullif(btrim(p_app_name), ''), p_app_slug), p_app_slug, 'customer');

  update public.company_invites set consumed_by = v_uid, consumed_at = now(), org_id = v_org where id = v_inv.id;
  delete from public.invite_claims c where lower(c.email::text) = lower(v_email);

  return query select p_org_slug, p_app_slug;
end $$;

-- The signed-in user joins a company from a member invite link. The link is the invite: it works once, for whoever
-- opens it first, and expires; the address it was made for is only a label (people sign in with GitHub, whose email
-- may not be the one the inviter knows). Someone already in the company keeps their current role.
create or replace function public.accept_member_invite(p_token text)
returns table (org_slug text)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_inv public.member_invites%rowtype;
  v_slug text;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;

  select * into v_inv from public.member_invites i
   where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
   for update;
  if not found then raise exception 'invite_not_found'; end if;
  if v_inv.accepted_at is not null then raise exception 'invite_used'; end if;
  if v_inv.revoked_at is not null then raise exception 'invite_revoked'; end if;
  if v_inv.expires_at <= now() then raise exception 'invite_expired'; end if;

  select o.slug::text into v_slug from public.organizations o where o.id = v_inv.org_id and o.deleted_at is null;
  if v_slug is null then raise exception 'invite_revoked'; end if; -- the company was deleted

  insert into public.org_members (org_id, user_id, role) values (v_inv.org_id, v_uid, v_inv.role)
  on conflict (org_id, user_id) do nothing;
  update public.member_invites set accepted_by = v_uid, accepted_at = now() where id = v_inv.id;

  return query select v_slug;
end $$;

-- Owners and admins invite an address to their company. Returns the raw token (43 url-safe characters), which is shown
-- once and never stored. A new invite replaces the address's pending one, whose link could not be shown again.
-- Invites last 7 days.
create or replace function public.invite_member(p_org uuid, p_email text, p_role text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower(btrim(p_email));
  v_token text;
begin
  if not public.has_org_role(p_org, '{owner,admin}') then raise exception 'forbidden'; end if;
  if p_role is null or p_role not in ('admin', 'member') then raise exception 'invalid_role'; end if;
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid_email';
  end if;
  if exists (select 1 from public.org_members m join auth.users u on u.id = m.user_id
             where m.org_id = p_org and lower(u.email) = v_email) then
    raise exception 'already_member';
  end if;

  update public.member_invites mi set revoked_at = now()
   where mi.org_id = p_org and lower(mi.email::text) = v_email and mi.accepted_at is null and mi.revoked_at is null;

  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.member_invites (org_id, email, role, token_hash, invited_by, expires_at)
  values (p_org, v_email, p_role, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_uid, now() + interval '7 days');
  return v_token;
end $$;

-- Owners change a member's role. A company always keeps at least one owner. The company row is locked so two owners
-- demoting each other at the same moment cannot both pass the last-owner check.
create or replace function public.set_member_role(p_org uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_current text;
begin
  if not public.has_org_role(p_org, '{owner}') then raise exception 'forbidden'; end if;
  if p_role is null or p_role not in ('owner', 'admin', 'member') then raise exception 'invalid_role'; end if;
  perform 1 from public.organizations o where o.id = p_org for update;
  select m.role into v_current from public.org_members m where m.org_id = p_org and m.user_id = p_user;
  if v_current is null then raise exception 'not_member'; end if;
  if v_current = 'owner' and p_role <> 'owner'
     and (select count(*) from public.org_members m where m.org_id = p_org and m.role = 'owner') <= 1 then
    raise exception 'last_owner';
  end if;
  update public.org_members m set role = p_role where m.org_id = p_org and m.user_id = p_user;
end $$;

-- Owners remove a member. A company always keeps at least one owner (locked as in set_member_role).
create or replace function public.remove_member(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_current text;
begin
  if not public.has_org_role(p_org, '{owner}') then raise exception 'forbidden'; end if;
  perform 1 from public.organizations o where o.id = p_org for update;
  select m.role into v_current from public.org_members m where m.org_id = p_org and m.user_id = p_user;
  if v_current is null then raise exception 'not_member'; end if;
  if v_current = 'owner'
     and (select count(*) from public.org_members m where m.org_id = p_org and m.role = 'owner') <= 1 then
    raise exception 'last_owner';
  end if;
  delete from public.org_members m where m.org_id = p_org and m.user_id = p_user;
end $$;

-- /admin: one row per company with counts only. Never member emails, issues or anything else inside a company.
create or replace function public.admin_company_summaries()
returns table (name text, slug text, created_at timestamptz, members int, apps int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  return query
    select o.name, o.slug::text, o.created_at,
           (select count(*)::int from public.org_members om where om.org_id = o.id),
           (select count(*)::int from public.projects pr where pr.org_id = o.id)
      from public.organizations o
     where o.deleted_at is null
     order by o.created_at desc;
end $$;

-- Supabase grants new functions to anon, authenticated and service_role directly, so "from public" alone is not enough.
revoke execute on function
  public.is_org_member(uuid), public.has_org_role(uuid, text[]), public.is_platform_admin(),
  public.create_org_from_invite(text, text, text, text, text), public.accept_member_invite(text),
  public.invite_member(uuid, text, text), public.set_member_role(uuid, uuid, text), public.remove_member(uuid, uuid),
  public.admin_company_summaries()
  from public, anon;
grant execute on function
  public.is_org_member(uuid), public.has_org_role(uuid, text[]), public.is_platform_admin(),
  public.create_org_from_invite(text, text, text, text, text), public.accept_member_invite(text),
  public.invite_member(uuid, text, text), public.set_member_role(uuid, uuid, text), public.remove_member(uuid, uuid),
  public.admin_company_summaries()
  to authenticated, service_role;
revoke execute on function public.slug_problem(text) from public, anon, authenticated;
grant execute on function public.slug_problem(text) to service_role;

-- An app without a company or a slug is unreachable, so both are required from here on.
alter table public.projects alter column org_id set not null, alter column slug set not null;

-- ---------------------------------------------------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------------------------------------------------

alter table public.organizations enable row level security;
create policy member_read on public.organizations for select to authenticated using (public.is_org_member(id));

-- All writes go through the RPCs above.
alter table public.org_members enable row level security;
create policy member_read on public.org_members for select to authenticated using (public.is_org_member(org_id));

alter table public.member_invites enable row level security;
create policy admin_read on public.member_invites for select to authenticated
  using (public.has_org_role(org_id, '{owner,admin}'));

revoke all on table public.organizations, public.org_members, public.member_invites from anon, authenticated;
grant select on table public.organizations, public.org_members, public.member_invites to authenticated;

-- Server only: RLS on with no policies, and no table grants for anon/authenticated.
alter table public.company_invites enable row level security;
alter table public.invite_claims enable row level security;
alter table public.platform_admins enable row level security;
revoke all on table public.company_invites, public.invite_claims, public.platform_admins from anon, authenticated;

-- Apps: only owners and admins change settings, and only these columns. The repo, keys, slug, kind and company are
-- written by the server. allowed_domains is left out on purpose: the column stays until the old sign-in code is gone.
drop policy member_update on public.projects;
create policy admin_update on public.projects for update to authenticated
  using (public.has_org_role(org_id, '{owner,admin}'))
  with check (public.has_org_role(org_id, '{owner,admin}'));
revoke update on public.projects from anon, authenticated;
grant update (name, route_map, score_weights, thresholds, alert_rules, widget_origins, design_path, watched_branch, slack_webhook_url)
  on public.projects to authenticated;

notify pgrst, 'reload schema';
