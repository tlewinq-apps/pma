-- Atomic claim so concurrent/cron/manual runs cannot double-process a source.
-- Returns true when this caller now owns the source.
create or replace function public.claim_source(p_id uuid)
returns boolean
language plpgsql
as $$
begin
  update public.sources
     set status = 'processing', locked_at = now(), attempts = attempts + 1, error = null
   where id = p_id
     and (status in ('queued', 'failed')
          or (status = 'processing' and locked_at < now() - interval '10 minutes'));
  return found;
end;
$$;
