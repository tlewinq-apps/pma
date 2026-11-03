-- Connect with GitHub: a company installs the PMA GitHub App on the accounts and repositories it chooses, and PMA
-- reads those repositories (private ones too) with short-lived installation tokens it mints when needed. Nothing secret
-- is stored: the company's github connection (company-level, 0030) keeps the installation id in external_id and the
-- account it's on in display.
--
-- * oauth_states accepts 'github' for the install and sign-in hand-offs (src/lib/github/install.ts).
-- * One installation belongs to one company at a time, like a Slack workspace: a second company that tries to connect
--   the same installation is refused, and this index stops two finishing at once.

alter table public.oauth_states drop constraint oauth_states_provider_check;
alter table public.oauth_states add constraint oauth_states_provider_check check (provider in ('slack', 'posthog', 'github'));

create unique index connections_github_installation on public.connections (external_id) where kind = 'github' and status = 'ok';
