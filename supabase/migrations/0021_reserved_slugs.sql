-- More reserved slugs. /sources and /sources/:id are redirects in next.config.ts (Sources became Add feedback), so a
-- company called "sources" would be unreachable; the rest are top-level paths PMA is likely to need soon.
--
-- Reserved slugs and the slug pattern for company and app slugs: an exact copy of src/lib/links.ts (RESERVED_SLUGS,
-- SLUG_PATTERN, slugProblem), reserved checked first. Change both together; tests/unit/slugParity.test.ts compares
-- src/lib/links.ts with the latest migration that defines this function. Returns 'slug_reserved', 'slug_invalid' or null.
-- Existing companies and apps keep their slugs: only create_org_from_invite calls this.
create or replace function public.slug_problem(p_slug text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_slug = any (array['sign-in', 'auth', 'api', 'admin', 'invite', 'join', 'onboarding', 'welcome',
                             'issues', 'feedback', 'flows', 'projects', 'work', 'settings', 'mock',
                             'widget.js', '_next', 'favicon.ico', 'icon.svg', 'no-company', 'apps',
                             'sources', 'oauth', 'connections', 'status', 'billing', 'help', 'docs']) then 'slug_reserved'
    when p_slug is null or p_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$' then 'slug_invalid'
  end
$$;

revoke execute on function public.slug_problem(text) from public, anon, authenticated;
grant execute on function public.slug_problem(text) to service_role;
