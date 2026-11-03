-- The company members page (/<company>/settings/members).
--
-- Member invites store only a hash of their token (0018_orgs.sql), so a pending invite's link can't be shown again.
-- An owner or admin can instead replace it (rotate_member_invite: a new token, a new hash, seven more days; the old link
-- stops working) or withdraw it (revoke_member_invite). Both act on pending invites only, an expired one included, and
-- raise the same reason codes as the other invite RPCs (forbidden, invite_used, invite_revoked). An invite id that does
-- not exist reads as forbidden, so ids can't be probed.
--
-- org_member_list returns a company's members with their emails, for the members page. Only members of that company
-- get rows; anyone else (a platform admin included) gets none.

create or replace function public.revoke_member_invite(p_invite uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_inv public.member_invites%rowtype;
begin
  select i.org_id into v_org from public.member_invites i where i.id = p_invite;
  if v_org is null or not public.has_org_role(v_org, '{owner,admin}') then raise exception 'forbidden'; end if;
  -- Locked after the role check, so only the company's own owners and admins can hold the row.
  select * into v_inv from public.member_invites i where i.id = p_invite for update;
  if v_inv.accepted_at is not null then raise exception 'invite_used'; end if;
  if v_inv.revoked_at is not null then raise exception 'invite_revoked'; end if;
  update public.member_invites set revoked_at = now() where id = v_inv.id;
end $$;

create or replace function public.rotate_member_invite(p_invite uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_inv public.member_invites%rowtype;
  v_token text;
begin
  select i.org_id into v_org from public.member_invites i where i.id = p_invite;
  if v_org is null or not public.has_org_role(v_org, '{owner,admin}') then raise exception 'forbidden'; end if;
  select * into v_inv from public.member_invites i where i.id = p_invite for update;
  if v_inv.accepted_at is not null then raise exception 'invite_used'; end if;
  if v_inv.revoked_at is not null then raise exception 'invite_revoked'; end if;

  -- The same token shape as invite_member: 43 url-safe characters, returned once and never stored.
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  update public.member_invites
     set token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex'), expires_at = now() + interval '7 days'
   where id = v_inv.id;
  return v_token;
end $$;

-- Owners first, then admins, then members, each by email.
create or replace function public.org_member_list(p_org uuid)
returns table (user_id uuid, email text, role text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, u.email::text, m.role, m.created_at
    from public.org_members m
    join auth.users u on u.id = m.user_id
   where m.org_id = p_org and public.is_org_member(p_org)
   order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, lower(u.email::text)
$$;

-- Supabase grants new functions to anon, authenticated and service_role directly, so "from public" alone is not enough.
revoke execute on function
  public.revoke_member_invite(uuid), public.rotate_member_invite(uuid), public.org_member_list(uuid)
  from public, anon;
grant execute on function
  public.revoke_member_invite(uuid), public.rotate_member_invite(uuid), public.org_member_list(uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';
