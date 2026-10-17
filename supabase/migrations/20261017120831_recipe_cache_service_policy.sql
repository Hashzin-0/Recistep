create policy recipe_cache_service_role_only
on public.recipe_cache
for all
to service_role
using (true)
with check (true);
