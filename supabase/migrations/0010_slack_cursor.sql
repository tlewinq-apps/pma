-- Slack sync cursor by activity id (strictly ordered, no timestamp ties) instead of a timestamp. A new thread starts
-- at the issue's latest activity, so history is not replayed (the first sync posts a catch-up instead).
-- Retries are dropped by header and every write has an idempotency key, so the event table is not needed.

drop function if exists public.claim_slack_thread(uuid);
alter table public.slack_threads drop column cursor;
alter table public.slack_threads add column last_activity_id bigint not null default 0;
drop table public.slack_events;
create index slack_users_user_id on public.slack_users (user_id);

create function public.claim_slack_thread(p_issue uuid)
returns setof public.slack_threads
language plpgsql set search_path = ''
as $$
begin
  insert into public.slack_threads (issue_id, last_activity_id)
    values (p_issue, coalesce((select max(id) from public.activity where issue_id = p_issue), 0))
    on conflict (issue_id) do nothing;
  return query update public.slack_threads set syncing_until = now() + interval '60 seconds'
    where issue_id = p_issue and (syncing_until is null or syncing_until < now())
    returning *;
end
$$;

-- Issues the cron sweep should sync: open issues without a card, and cards with activity past their cursor.
create function public.slack_stale_issues(p_project uuid, p_limit int)
returns table (issue_id uuid)
language sql stable set search_path = ''
as $$
  select i.id from public.issues i left join public.slack_threads t on t.issue_id = i.id
  where i.project_id = p_project and (
    (t.ts is null and i.status not in ('dismissed', 'shipped'))
    or (t.ts is not null and exists (select 1 from public.activity a where a.issue_id = i.id and a.id > t.last_activity_id)))
  order by i.updated_at desc
  limit p_limit
$$;

revoke execute on function public.claim_slack_thread(uuid) from public, anon, authenticated;
grant execute on function public.claim_slack_thread(uuid) to service_role;
revoke execute on function public.slack_stale_issues(uuid, int) from public, anon, authenticated;
grant execute on function public.slack_stale_issues(uuid, int) to service_role;
