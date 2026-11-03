-- Approving a customer app's mock-up no longer ships anything (spec call 11): the issue becomes 'ready_to_build', and
-- it is shipped only when a linked code pull request merges. The demo app's approve keeps marking it 'shipped'.
-- Re-runnable: the status check is dropped by name and added again with the new value.
alter table public.issues drop constraint if exists issues_status_check;
alter table public.issues add constraint issues_status_check
  check (status in ('new','drafting','draft_ready','in_review','ready_to_build','shipped','dismissed'));
