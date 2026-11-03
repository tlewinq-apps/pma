-- Build it (spec section 8): after a customer approves a mock-up and picks a pull request, PMA writes the change with
-- Claude (on the company's key), commits it through the company's PMA GitHub App installation, and opens or updates
-- the pull request. One row per attempt; a retry is a new row, so the history stays.
--
-- * mode: new_pr (a fresh pma/<short>-build-<n> branch from the default branch) or branch (fast-forwards a branch
--   the company picked). base_branch is what it was built on; head_branch where the commit went.
-- * status: queued -> running -> opened (the pull request exists and is linked in pull_request_links), or failed with
--   `error`, a sentence for the person. steps: short progress lines for the issue page. files: the paths it changed.
-- * A run is one function invocation (Vercel stops it at 300 s), so a build can take several: after each Claude turn
--   it saves `transcript` (the turns after the brief) and `staged` (path -> new content), and hands itself to a fresh
--   invocation before the time runs out. `lease` names the invocation that owns it; locked_at is when it took it.
-- * attempts and locked_at let /api/cron/process pick up a build whose run never started or was cut off.
--
-- Members read their apps' builds (is_member); every write goes through the server with the service role.

create table if not exists public.builds (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues on delete cascade,
  project_id uuid not null references public.projects on delete cascade,
  mode text not null check (mode in ('new_pr', 'branch')),
  base_branch text,
  head_branch text,
  status text not null default 'queued' check (status in ('queued', 'running', 'opened', 'failed')),
  steps jsonb not null default '[]'::jsonb,
  files jsonb not null default '[]'::jsonb,
  summary text,
  error text,
  pr_url text,
  pr_number integer,
  commit_sha text,
  base_sha text,
  transcript jsonb not null default '[]'::jsonb,
  staged jsonb not null default '{}'::jsonb,
  turns integer not null default 0,
  stalls integer not null default 0,
  runs integer not null default 0,
  lease uuid,
  attempts integer not null default 0,
  locked_at timestamptz,
  started_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The issue page reads an issue's latest build; the cron finds builds left queued or running.
create index if not exists builds_issue_created on public.builds (issue_id, created_at desc);
create index if not exists builds_unfinished on public.builds (status, updated_at) where status in ('queued', 'running');
create index if not exists builds_project_id on public.builds (project_id);

alter table public.builds enable row level security;
drop policy if exists member_read on public.builds;
create policy member_read on public.builds for select to authenticated using (public.is_member(project_id));

revoke all on table public.builds from anon, authenticated;
grant select on table public.builds to authenticated;

notify pgrst, 'reload schema';
