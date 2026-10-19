-- Persist recipe utensils as structured, editable data.
create table if not exists public.recipe_utensils (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  purpose text check (purpose is null or length(purpose) <= 500),
  quantity text check (quantity is null or length(quantity) <= 80),
  source_evidence text check (source_evidence is null or length(source_evidence) <= 1000),
  confidence numeric(4,3) not null default 0.7 check (confidence between 0 and 1),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now()
);
create index if not exists recipe_utensils_recipe_position_idx
  on public.recipe_utensils (recipe_id, position);
alter table public.recipe_utensils enable row level security;
create policy recipe_utensils_select_own on public.recipe_utensils
  for select to authenticated using (exists (
    select 1 from public.recipes r where r.id = recipe_id and r.user_id = (select auth.uid())
  ));
create policy recipe_utensils_insert_own on public.recipe_utensils
  for insert to authenticated with check (exists (
    select 1 from public.recipes r where r.id = recipe_id and r.user_id = (select auth.uid())
  ));
create policy recipe_utensils_update_own on public.recipe_utensils
  for update to authenticated using (exists (
    select 1 from public.recipes r where r.id = recipe_id and r.user_id = (select auth.uid())
  )) with check (exists (
    select 1 from public.recipes r where r.id = recipe_id and r.user_id = (select auth.uid())
  ));
create policy recipe_utensils_delete_own on public.recipe_utensils
  for delete to authenticated using (exists (
    select 1 from public.recipes r where r.id = recipe_id and r.user_id = (select auth.uid())
  ));
grant select, insert, update, delete on public.recipe_utensils to authenticated;
