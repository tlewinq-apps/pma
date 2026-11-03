-- Who drafted a mockup: the GitHub Action (Marver in Actions), the in-app mock runner that plays the Action through
-- the same dispatch and callback contract, or the demo renderer. Existing demo drafts are backfilled.
alter table public.drafts add column if not exists backend text not null default 'github'
  check (backend in ('github', 'mock', 'demo'));
update public.drafts set backend = 'demo' where demo;
