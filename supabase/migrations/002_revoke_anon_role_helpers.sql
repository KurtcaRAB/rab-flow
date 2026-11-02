-- The role helpers only answer "is the caller staff / office". Signed-out
-- visitors have no reason to call them (Supabase security advisor 0028).
revoke execute on function public.is_staff() from public, anon;
revoke execute on function public.is_office() from public, anon;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_office() to authenticated;
