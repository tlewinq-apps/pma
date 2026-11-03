-- Diagnose-first bugs (src/lib/diagnosis): a bug is diagnosed before any fix is proposed. Kept apart from
-- score_breakdown, which every re-score replaces. { status: running|done|failed, started_at, finished_at, by, steps,
-- finding: { cause, evidence, logging_added, where, confidence }, simulated }.
alter table public.issues add column if not exists diagnosis jsonb;
