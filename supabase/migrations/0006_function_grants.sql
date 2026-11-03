-- Functions get EXECUTE for PUBLIC by default, so earlier `revoke ... from anon` was a no-op.
-- RLS policies call is_member as the signed-in user, so `authenticated` keeps it.
revoke execute on function public.is_member(uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated, service_role;

revoke execute on function public.project_member_emails(uuid) from public, anon;
grant execute on function public.project_member_emails(uuid) to authenticated, service_role;

-- Only the server (service role) claims sources for the pipeline.
revoke execute on function public.claim_source(uuid) from public, anon, authenticated;
grant execute on function public.claim_source(uuid) to service_role;

-- Vector match RPCs are called by the service-role pipeline only.
revoke execute on function public.match_screens(uuid, vector, int) from public, anon, authenticated;
grant execute on function public.match_screens(uuid, vector, int) to service_role;
revoke execute on function public.match_issues(uuid, vector, int, float) from public, anon, authenticated;
grant execute on function public.match_issues(uuid, vector, int, float) to service_role;
