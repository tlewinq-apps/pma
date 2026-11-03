create extension if not exists vector;

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  repo_full_name text,
  design_path text not null default 'design',
  watched_branch text not null default 'main',
  slack_webhook_url text,
  widget_key text not null default encode(gen_random_bytes(16), 'hex'),
  widget_origins text[] not null default '{}',
  route_map jsonb not null default '{}',          -- { "/journal": "journal/entry" }
  score_weights jsonb,
  thresholds jsonb,
  allowed_domains text[] not null default '{}',
  api_key text not null default encode(gen_random_bytes(24), 'hex'),
  created_at timestamptz not null default now()
);

create table members (
  project_id uuid references projects on delete cascade,
  user_id uuid references auth.users on delete cascade,
  role text not null default 'member',
  primary key (project_id, user_id)
);

create or replace function is_member(p uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.members where project_id = p and user_id = auth.uid())
$$;
revoke execute on function public.is_member(uuid) from anon;

create table sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  kind text not null check (kind in ('paste','file','widget','slack','granola','posthog','marver_comment')),
  channel text, author text, occurred_at timestamptz default now(),
  raw_text text not null, content_hash text not null, file_path text, route text,
  metadata jsonb not null default '{}', demo boolean not null default false,
  status text not null default 'queued' check (status in ('queued','processing','done','failed')),
  attempts int not null default 0, error text, locked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, content_hash)
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  code text not null, section text, title text not null, statement text,
  current_flow_md text, related_codes text[] not null default '{}',
  unique (project_id, code)
);

create table screens (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  frame_id text not null, scene text not null, file text not null,
  title text, description text, copy_text text, variant_group text,
  job_codes text[] not null default '{}', embedding vector(1024),
  unique (project_id, frame_id)
);

create table issues (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  short_id text not null default substr(encode(gen_random_bytes(4),'hex'),1,6),
  title text not null, problem_statement text not null,
  type text not null check (type in ('bug','new_feature','add_on','streamline')),
  job_id uuid references jobs, lane text check (lane in ('quick_win','explore','watch','backlog')),
  importance int, ease int, score_breakdown jsonb, people_count numeric not null default 0,
  status text not null default 'new' check (status in ('new','drafting','draft_ready','in_review','shipped','dismissed')),
  owner_id uuid references auth.users, decision text, embedding vector(1024),
  last_reported_at timestamptz not null default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table feedback_units (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources on delete cascade,
  project_id uuid not null references projects on delete cascade,
  issue_id uuid references issues on delete set null,
  quote text not null, span_start int, span_end int,
  speakers text[] not null default '{}', corroborators text[] not null default '{}', reported_count int not null default 0,
  type text not null check (type in ('bug','new_feature','add_on','streamline','praise','question','irrelevant')),
  filtered_reason text, sentiment int check (sentiment between -2 and 2), emotion text, audience text,
  severity_signals jsonb not null default '{}', job_code text, embedding vector(1024),
  created_at timestamptz not null default now()
);

create table issue_screens (
  issue_id uuid references issues on delete cascade,
  screen_id uuid references screens on delete cascade,
  position int not null default 0, confidence real not null, evidence text,
  primary key (issue_id, screen_id)
);
create table unit_screens (
  unit_id uuid references feedback_units on delete cascade,
  screen_id uuid references screens on delete cascade,
  confidence real not null, evidence text,
  primary key (unit_id, screen_id)
);

create table solutions (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues on delete cascade,
  rank int not null, title text not null, summary text not null, tradeoffs text,
  effort text, risk text, recommended boolean not null default false,
  mode text not null default 'variant' check (mode in ('variant','round')),
  target_frames text[] not null default '{}'
);

create table drafts (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues on delete cascade,
  solution_id uuid references solutions,
  mode text not null, branch text, pr_url text, pr_number int, pr_state text,
  before_images jsonb not null default '[]', after_images jsonb not null default '[]',
  marver_paths text[] not null default '{}',
  status text not null default 'dispatched' check (status in ('dispatched','ready','failed')),
  callback_token text not null, callback_used_at timestamptz, log_url text,
  created_at timestamptz not null default now()
);

create table activity (
  id bigint generated always as identity primary key,
  issue_id uuid not null references issues on delete cascade,
  user_id uuid references auth.users, kind text not null, payload jsonb not null default '{}',
  at timestamptz not null default now()
);

create table label_corrections (
  id bigint generated always as identity primary key,
  project_id uuid not null references projects on delete cascade,
  unit_id uuid references feedback_units on delete cascade,
  field text not null, old_value text, new_value text not null, user_id uuid, at timestamptz not null default now()
);

create index on feedback_units (issue_id);
create index on sources (project_id, status);
create index on activity (issue_id, at desc);

create or replace function match_screens(p_project uuid, p_embedding vector(1024), p_k int)
returns table (id uuid, frame_id text, scene text, title text, description text, copy_text text, similarity float)
language sql stable as $$
  select id, frame_id, scene, title, description, copy_text, 1 - (embedding <=> p_embedding) as similarity
  from screens where project_id = p_project and embedding is not null
  order by embedding <=> p_embedding limit p_k
$$;

create or replace function match_issues(p_project uuid, p_embedding vector(1024), p_k int, p_min_sim float)
returns table (id uuid, title text, problem_statement text, type text, similarity float)
language sql stable as $$
  select id, title, problem_statement, type, 1 - (embedding <=> p_embedding) as similarity
  from issues where project_id = p_project and embedding is not null and status <> 'dismissed'
    and 1 - (embedding <=> p_embedding) >= p_min_sim
  order by embedding <=> p_embedding limit p_k
$$;

-- RLS: members read/write their project's rows; the service role bypasses RLS.
do $$ declare t text; begin
  foreach t in array array['sources','jobs','screens','issues','feedback_units','label_corrections'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy member_all on %I for all using (is_member(project_id)) with check (is_member(project_id))', t);
  end loop;
end $$;
alter table projects enable row level security;
create policy member_read on projects for select using (is_member(id));
create policy member_update on projects for update using (is_member(id));
alter table members enable row level security;
create policy self_read on members for select using (user_id = auth.uid());
alter table issue_screens enable row level security;
create policy member_all on issue_screens for all using (exists(select 1 from issues i where i.id = issue_id and is_member(i.project_id)));
alter table unit_screens enable row level security;
create policy member_all on unit_screens for all using (exists(select 1 from feedback_units u where u.id = unit_id and is_member(u.project_id)));
alter table solutions enable row level security;
create policy member_all on solutions for all using (exists(select 1 from issues i where i.id = issue_id and is_member(i.project_id)));
alter table drafts enable row level security;
create policy member_all on drafts for all using (exists(select 1 from issues i where i.id = issue_id and is_member(i.project_id)));
alter table activity enable row level security;
create policy member_all on activity for all using (exists(select 1 from issues i where i.id = issue_id and is_member(i.project_id)));

insert into storage.buckets (id, name, public) values ('uploads','uploads', false), ('shots','shots', true) on conflict do nothing;
