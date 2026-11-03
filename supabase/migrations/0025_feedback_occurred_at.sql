-- Report dates follow when the feedback happened, not when PMA filed it (src/lib/urgency). Each piece carries its
-- source's occurred_at, so urgency's last 30 days and weekly buckets, priority's recency and the daily re-score read
-- the real date, and a backdated import (a Slack history, last month's call) no longer reads as fresh.
alter table public.feedback_units add column if not exists occurred_at timestamptz;

update public.feedback_units u set occurred_at = coalesce(s.occurred_at, s.created_at)
from public.sources s
where s.id = u.source_id and u.occurred_at is null;

alter table public.feedback_units
  alter column occurred_at set default now(),
  alter column occurred_at set not null;

-- An issue was last reported when its newest piece happened, not when that piece was last filed under it.
update public.issues i set last_reported_at = m.at
from (select issue_id, max(occurred_at) as at from public.feedback_units where issue_id is not null group by issue_id) m
where m.issue_id = i.id;

-- The daily re-score counts each issue's pieces from the last 7 days (src/lib/pipeline/age.ts).
create index if not exists feedback_units_issue_occurred on public.feedback_units (issue_id, occurred_at);
