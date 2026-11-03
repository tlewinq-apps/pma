-- Every 5 minutes, the database itself calls the app's /api/cron/process (queued sources, retries, the Slack sweep).
-- Vercel's Hobby plan only allows daily crons, so pg_cron + pg_net do the scheduling instead.
--
-- This migration schedules nothing. Scheduling needs the app's public URL and CRON_SECRET, which live in Vault and are
-- written by `npm run cron:setup` (scripts/cron-setup.ts) through public.set_cron_config. Until that runs, an
-- environment (dev, for one) simply has no job.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- GET <pma_app_url><p_path> with the cron secret as a bearer token; returns the pg_net request id. The response
-- lands in net._http_response (kept for 6 hours), so `select status_code from net._http_response order by created desc
-- limit 1` shows whether the last call got a 200. Only the cron job (running as postgres) may call it.
create or replace function public.call_cron(p_path text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'pma_app_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'pma_cron_secret';
  if v_url is null or v_secret is null then
    raise exception 'cron is not configured for this database: run npm run cron:setup';
  end if;
  return net.http_get(
    url := v_url || p_path,
    headers := jsonb_build_object('authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 290000
  );
end $$;

-- Supabase grants new functions to anon, authenticated and service_role directly, so "from public" alone is not enough.
revoke all on function public.call_cron(text) from public, anon, authenticated, service_role;

-- Stores the app URL and cron secret in Vault (create, or update when the name exists), then (re)schedules the job.
-- cron.schedule with an existing job name replaces that job, so running this again is safe. Service role only.
create or replace function public.set_cron_config(p_app_url text, p_secret text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if coalesce(p_app_url, '') = '' or coalesce(p_secret, '') = '' then
    raise exception 'set_cron_config needs an app url and a secret';
  end if;

  select id into v_id from vault.secrets where name = 'pma_app_url';
  if v_id is null then
    perform vault.create_secret(rtrim(p_app_url, '/'), 'pma_app_url', 'Public URL of the app that pg_cron calls');
  else
    perform vault.update_secret(v_id, rtrim(p_app_url, '/'));
  end if;

  select id into v_id from vault.secrets where name = 'pma_cron_secret';
  if v_id is null then
    perform vault.create_secret(p_secret, 'pma_cron_secret', 'Bearer token the app checks on /api/cron/*');
  else
    perform vault.update_secret(v_id, p_secret);
  end if;

  perform cron.schedule('pma-process', '*/5 * * * *', 'select public.call_cron(''/api/cron/process'')');
end $$;

revoke all on function public.set_cron_config(text, text) from public, anon, authenticated;
grant execute on function public.set_cron_config(text, text) to service_role;
