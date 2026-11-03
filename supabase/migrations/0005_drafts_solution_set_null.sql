-- Allow solutions to be replaced (solveAndDraft) while an older draft still references them.
alter table drafts drop constraint if exists drafts_solution_id_fkey;
alter table drafts add constraint drafts_solution_id_fkey foreign key (solution_id) references solutions (id) on delete set null;
