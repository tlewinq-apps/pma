create or replace function public.project_member_emails(p_project uuid) returns table (user_id uuid, email text)
language sql stable security definer set search_path = '' as $$
  select m.user_id, u.email::text from public.members m join auth.users u on u.id = m.user_id
  where m.project_id = p_project and public.is_member(p_project)
$$;
revoke execute on function public.project_member_emails(uuid) from anon;
