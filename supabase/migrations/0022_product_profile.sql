-- What each app is, in its own words: { name, one_liner, audience, audience_one, platform } (src/lib/product/profile.ts).
-- Prompts and the audience words on screen are written from it, so a customer app's feedback is read as feedback about
-- its own product. The demo app (kind 'demo') ignores it and uses the Celeste profile; null means
-- the generic profile until one is saved.
--
-- Written by the server only (service role, after an owner or admin check). It is deliberately left out of 0018's
-- column-level UPDATE grant to authenticated, so a signed-in user cannot write it directly; they can read it with the
-- rest of the row.
alter table public.projects add column if not exists product_profile jsonb;

comment on column public.projects.product_profile is
  'What the app is, in its own words: {name, one_liner, audience, audience_one, platform}. Written by the server only.';

notify pgrst, 'reload schema';
