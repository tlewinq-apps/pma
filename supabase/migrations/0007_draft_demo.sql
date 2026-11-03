-- Drafts produced by the built-in demo drafter (no design repo / GitHub token configured). They advance to ready
-- with schematic before/after renders and are approved without GitHub; the UI labels them as demo.
alter table drafts add column demo boolean not null default false;
