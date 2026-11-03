-- PM-editable proposals. origin: who wrote it ('ai' = PMA, 'pm' = a team member). edited_by/edited_at: the
-- last person to change it. original: PMA's version, captured on the first edit so it can be restored.
-- Re-proposing replaces only untouched PMA proposals (see lib/proposals.ts regeneratePlan).
alter table solutions
  add column origin text not null default 'ai' check (origin in ('ai','pm')),
  add column edited_by uuid references auth.users,
  add column edited_at timestamptz,
  add column original jsonb;
