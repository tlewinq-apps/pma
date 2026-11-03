-- Open sign-up. Anyone may create an account, and a signed-in person in no company may set one up themselves, with no
-- invite. Company and teammate invites keep working as before.
--
-- * organizations.self_serve marks a company set up without an invite. Its Claude calls run only on its own key: PMA's
--   key never stands in for it (src/lib/connections/claude.ts), so open sign-up can't spend PMA's budget.
-- * create_org_core is the one place a company, its owner and its first app are made, after the slug checks. The invite
--   way in (create_org_for_invite, 0023) and the open way in (create_org_open) both call it, so they apply the same
--   slug checks in the same order. It is callable only from those functions (no grant to anon or authenticated).
-- * create_org_open sets up a company for the caller, who must be signed in and in no company yet: one account opens
--   at most one company this way.
-- * hook_before_user_created (0019) now lets every address through. It is kept, not dropped, so an auth config that
--   still enables it never blocks sign-up, and so there is one place to refuse addresses again later.

alter table public.organizations add column self_serve boolean not null default false;

create or replace function public.create_org_core(p_uid uuid, p_org_name text, p_org_slug text, p_app_name text, p_app_slug text, p_self_serve boolean)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  -- Company slugs are unique across PMA; app slugs are unique within their company. Valid slugs are lowercase, so
  -- comparing lower(slug) finds a taken one whatever its stored case.
  if public.slug_problem(p_org_slug) is not null then raise exception '%', public.slug_problem(p_org_slug); end if;
  if exists (select 1 from public.organizations o where lower(o.slug::text) = p_org_slug) then
    raise exception 'slug_taken';
  end if;
  if public.slug_problem(p_app_slug) is not null then raise exception '%', public.slug_problem(p_app_slug); end if;

  begin
    insert into public.organizations (name, slug, created_by, self_serve)
    values (coalesce(nullif(btrim(p_org_name), ''), p_org_slug), p_org_slug, p_uid, p_self_serve)
    returning id into v_org;
  exception when unique_violation then
    raise exception 'slug_taken'; -- taken between the check above and this insert
  end;
  insert into public.org_members (org_id, user_id, role) values (v_org, p_uid, 'owner');

  if exists (select 1 from public.projects pr where pr.org_id = v_org and lower(pr.slug::text) = p_app_slug) then
    raise exception 'slug_taken';
  end if;
  insert into public.projects (org_id, name, slug, kind)
  values (v_org, coalesce(nullif(btrim(p_app_name), ''), p_app_slug), p_app_slug, 'customer');
  return v_org;
end $$;

-- The invite way in: the invite checks as in 0023, then the shared core. Same signature, errors and order as before.
create or replace function public.create_org_for_invite(p_invite uuid, p_org_name text, p_org_slug text, p_app_name text, p_app_slug text)
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

  select * into v_inv from public.company_invites i where i.id = p_invite for update;
  if not found then raise exception 'invite_not_found'; end if;
  if v_inv.consumed_at is not null then raise exception 'invite_used'; end if;
  if v_inv.revoked_at is not null then raise exception 'invite_revoked'; end if;
  if v_inv.expires_at <= now() then raise exception 'invite_expired'; end if;
  if v_inv.email is not null and lower(v_inv.email::text) is distinct from lower(v_email) then
    raise exception 'invite_email';
  end if;

  v_org := public.create_org_core(v_uid, p_org_name, p_org_slug, p_app_name, p_app_slug, false);

  update public.company_invites set consumed_by = v_uid, consumed_at = now(), org_id = v_org where id = v_inv.id;
  delete from public.invite_claims c where lower(c.email::text) = lower(v_email);

  return query select p_org_slug, p_app_slug;
end $$;

-- The open way in: a signed-in person in no company sets one up. 'already_in_company' if they're in one (a deleted
-- company doesn't count).
create or replace function public.create_org_open(p_org_name text, p_org_slug text, p_app_name text, p_app_slug text)
returns table (org_slug text, app_slug text)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  -- One open company per account: a lock per person until this transaction ends, so two quick submits can't both pass.
  perform pg_advisory_xact_lock(hashtext('create_org_open'), hashtext(v_uid::text));
  if exists (select 1 from public.org_members m join public.organizations o on o.id = m.org_id
              where m.user_id = v_uid and o.deleted_at is null) then
    raise exception 'already_in_company';
  end if;
  perform public.create_org_core(v_uid, p_org_name, p_org_slug, p_app_name, p_app_slug, true);
  return query select p_org_slug, p_app_slug;
end $$;

-- Every address may sign up now. Same signature and grants as 0019.
create or replace function public.hook_before_user_created(event jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  return '{}'::jsonb;
end $$;

-- Supabase grants new functions to anon, authenticated and service_role directly, so "from public" alone is not enough.
revoke execute on function public.create_org_core(uuid, text, text, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.create_org_open(text, text, text, text) from public, anon;
grant execute on function public.create_org_open(text, text, text, text) to authenticated, service_role;
