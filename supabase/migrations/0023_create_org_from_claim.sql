-- Finish setting up a company without the invite link. A person who opened a company invite and asked for a sign-in
-- link has an invite_claims row for their address (the /invite page writes it before sending the email). If they land
-- signed in anywhere but back on the invite (an operator's one-time link, a lost tab), /no-company offers to finish
-- setting up their company, and this function creates it from the invite their claim points at, so the raw token never
-- has to travel again.
--
-- Both ways in now share one core, create_org_for_invite, so they apply exactly the same checks in the same order: the
-- invite is locked, then must be unused, not revoked and unexpired, then locked to the caller's address if it names
-- one, then the slugs (reserved, invalid, taken). The core consumes the invite and deletes the caller's claims. It is
-- callable only from the two functions below (no grant to anon or authenticated).

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

-- The invite link's way in (0018), now through the shared core. Same signature, grants and errors as before.
create or replace function public.create_org_from_invite(p_token text, p_org_name text, p_org_slug text, p_app_name text, p_app_slug text)
returns table (org_slug text, app_slug text)
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'not_signed_in'; end if;
  select i.id into v_id from public.company_invites i where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if v_id is null then raise exception 'invite_not_found'; end if;
  return query select * from public.create_org_for_invite(v_id, p_org_name, p_org_slug, p_app_name, p_app_slug);
end $$;

-- The claim's way in: the invite the caller's own unexpired claim points at, found by their auth.users email (never an
-- id or address from the browser). No claim, or only an expired one, is 'claim_not_found'.
create or replace function public.create_org_from_claim(p_org_name text, p_org_slug text, p_app_name text, p_app_slug text)
returns table (org_slug text, app_slug text)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  select u.email::text into v_email from auth.users u where u.id = v_uid;
  select c.company_invite_id into v_id from public.invite_claims c
   where lower(c.email::text) = lower(v_email) and c.expires_at > now();
  if v_id is null then raise exception 'claim_not_found'; end if;
  return query select * from public.create_org_for_invite(v_id, p_org_name, p_org_slug, p_app_name, p_app_slug);
end $$;

-- Supabase grants new functions to anon, authenticated and service_role directly, so "from public" alone is not enough.
revoke execute on function public.create_org_for_invite(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.create_org_from_claim(text, text, text, text) from public, anon;
grant execute on function public.create_org_from_claim(text, text, text, text) to authenticated, service_role;
