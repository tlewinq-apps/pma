-- Invite-only sign-up. Supabase Auth calls public.hook_before_user_created before it creates any user (the
-- before-user-created auth hook: enabled in supabase/config.toml for dev, and in the dashboard for production). A new
-- account is allowed only for an address that holds
--   * an unexpired invite_claims row (the /invite page writes one when a signed-out person asks for a sign-in link on a
--     company invite; it lasts as long as that link), or
--   * a pending member_invites row (not accepted, not withdrawn, not expired).
-- Anyone else is refused with 403 "Invite only", and Auth sends no email. Signing in to an existing account never
-- reaches this hook.
--
-- As Supabase's auth-hook guide asks: the function is not security definer. It runs as supabase_auth_admin, which may
-- execute it and read the two tables it checks (RLS stays on, with a read policy for that role alone). No other role
-- can call it, so it is not reachable through the Data API.

create or replace function public.hook_before_user_created(event jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_email text := lower(btrim(event->'user'->>'email'));
begin
  if v_email is not null and v_email <> '' and (
       exists (select 1 from public.invite_claims c
                where lower(c.email::text) = v_email and c.expires_at > now())
    or exists (select 1 from public.member_invites m
                where lower(m.email::text) = v_email
                  and m.accepted_at is null and m.revoked_at is null and m.expires_at > now())
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Invite only'));
end $$;

-- Supabase grants new functions to anon, authenticated and service_role directly, so each is revoked by name.
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

grant usage on schema public to supabase_auth_admin;
grant select on table public.invite_claims, public.member_invites to supabase_auth_admin;
create policy auth_admin_read on public.invite_claims for select to supabase_auth_admin using (true);
create policy auth_admin_read on public.member_invites for select to supabase_auth_admin using (true);
