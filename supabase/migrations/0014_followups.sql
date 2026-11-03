-- Follow-up questions for vague feedback (src/lib/followups.ts): drafted when clarity is rated low, then asked in the
-- reporters' own Slack threads. { questions, drafted_at, asked_at, asked }.
alter table public.issues add column if not exists followups jsonb;
