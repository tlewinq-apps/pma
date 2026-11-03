-- After a customer approves a mock-up (spec section 8 and call 11): how it gets built, the pull request that builds it,
-- and an optional preview of that pull request.
--
-- 1. projects.settings: the app's settings as JSON, written only by the server. Its first key is `build`, the company's
--    default answer to "How should this be built?" ({"mode": "claude_code"}; "new_pr" and "branch" need the PMA GitHub
--    App). Signed-in users get no UPDATE grant on it (0018 grants a fixed column list), so owners and admins change it
--    through a role-checked route that writes with the service role, like product_profile (0022).
-- 2. pull_request_links: a code pull request linked to an issue, pasted by an owner, an admin or the issue's owner
--    (the route checks the role and that the URL is a pull request in the app's connected repository) until the GitHub
--    App links them on its own. Members read them through the issue's app (is_member); every write goes through the
--    server with the service role, so signed-in users get SELECT only.
--
-- Re-runnable: every statement checks before it creates. The name issue_links belongs to the connectors work (0031).

alter table public.projects add column if not exists settings jsonb not null default '{}'::jsonb;
comment on column public.projects.settings is
  'App settings written by the server after a role check. build: {"mode": "new_pr" | "branch" | "claude_code", "branch"?: text}, the default answer to "How should this be built?".';

create table if not exists public.pull_request_links (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues on delete cascade,
  -- Stored in one shape: https://github.com/<owner>/<repo>/pull/<number>.
  url text not null check (url ~ '^https://github\.com/[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}/pull/[1-9][0-9]{0,9}$'),
  repo text not null check (repo ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$'),
  number integer not null check (number > 0),
  -- 'merged' is set when an owner or admin marks the issue shipped (until GitHub's webhook reports it).
  state text not null default 'open' check (state in ('open', 'merged', 'closed')),
  -- Their own preview deployment (Vercel, Netlify, ...), shown as "See it live".
  preview_url text check (preview_url is null or (preview_url ~ '^https://' and length(preview_url) <= 500)),
  linked_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

-- One link per pull request per issue; GitHub names are case-insensitive.
create unique index if not exists pull_request_links_issue_pr on public.pull_request_links (issue_id, lower(repo), number);
-- The issue page lists an issue's links newest first; also covers the foreign key.
create index if not exists pull_request_links_issue_created on public.pull_request_links (issue_id, created_at desc);

alter table public.pull_request_links enable row level security;
drop policy if exists member_read on public.pull_request_links;
create policy member_read on public.pull_request_links for select to authenticated
  using (exists (select 1 from public.issues i where i.id = issue_id and public.is_member(i.project_id)));

revoke all on table public.pull_request_links from anon, authenticated;
grant select on table public.pull_request_links to authenticated;

notify pgrst, 'reload schema';
