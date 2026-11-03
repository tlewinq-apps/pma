-- Marver frames and flows (src/lib/marver). PMA now draws the canvas's frames itself (parsed, never run), so a
-- screen keeps its TSX source, and the canvas's flow boards (design/boards/flow-*.json: frames in step order) are
-- synced next to the screens.
alter table public.screens add column if not exists source text;

-- The Marver frames a draft wrote: [{ frame_id, path, source, changed }] (the proposed end-result screen).
alter table public.drafts add column if not exists frames jsonb not null default '[]';
-- "Create full flow" for a draft: { status: drafting|ready|failed, board, title, started_at, finished_at, error,
-- image_url, by, steps: [{ current, frame_id, change: same|changed|new, title, source, caption }] }.
alter table public.drafts add column if not exists flow jsonb;

create table if not exists public.flows (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  board text not null,
  title text not null,
  description text,
  frames text[] not null default '{}',
  position int not null default 0,
  unique (project_id, board)
);
alter table public.flows enable row level security;
drop policy if exists member_all on public.flows;
create policy member_all on public.flows for all using (public.is_member(project_id)) with check (public.is_member(project_id));
