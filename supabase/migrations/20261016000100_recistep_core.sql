-- Recistep core schema.
-- Apply only to the dedicated Recistep Supabase project after reviewing this migration.
create extension if not exists pgcrypto;

create table if not exists public.source_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_url text not null check (length(source_url) <= 2048),
  platform text not null check (platform in ('youtube', 'tiktok', 'instagram')),
  locale text not null default 'pt-BR' check (length(locale) between 2 and 20),
  servings_target numeric(8,2) check (servings_target is null or servings_target > 0),
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  status text not null default 'queued' check (status in (
    'queued', 'processing', 'source_content_required', 'review_required',
    'completed', 'failed', 'cancelled'
  )),
  source_metadata jsonb,
  source_transcript text check (source_transcript is null or length(source_transcript) <= 80000),
  recipe_draft jsonb,
  error_code text,
  error_message text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index if not exists source_imports_user_created_idx
  on public.source_imports (user_id, created_at desc);
create index if not exists source_imports_status_created_idx
  on public.source_imports (status, created_at);

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_import_id uuid references public.source_imports(id) on delete set null,
  title text not null check (length(title) between 1 and 200),
  description text,
  source_url text,
  source_language text,
  servings numeric(8,2) check (servings is null or servings > 0),
  prep_seconds integer check (prep_seconds is null or prep_seconds >= 0),
  cook_seconds integer check (cook_seconds is null or cook_seconds >= 0),
  total_seconds integer check (total_seconds is null or total_seconds >= 0),
  uncertainties jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  is_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_import_id)
);

create index if not exists recipes_user_updated_idx
  on public.recipes (user_id, updated_at desc);

create table if not exists public.ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  name text not null check (length(name) between 1 and 200),
  quantity numeric(12,4) check (quantity is null or quantity > 0),
  unit text,
  notes text,
  source_evidence text,
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now()
);

create index if not exists ingredients_recipe_position_idx
  on public.ingredients (recipe_id, position);

create table if not exists public.preparation_steps (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  position integer not null check (position >= 0),
  instruction text not null check (length(instruction) between 1 and 4000),
  duration_seconds integer check (duration_seconds is null or duration_seconds between 0 and 86400),
  temperature_value numeric(8,2),
  temperature_unit text check (temperature_unit is null or temperature_unit in ('C', 'F')),
  source_evidence text,
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  unique (recipe_id, position)
);

create index if not exists preparation_steps_recipe_position_idx
  on public.preparation_steps (recipe_id, position);

alter table public.source_imports enable row level security;
alter table public.recipes enable row level security;
alter table public.ingredients enable row level security;
alter table public.preparation_steps enable row level security;

-- Import rows are accessed only by trusted server code after validating the
-- Supabase access token. The Data API has no grants on this table.
drop policy if exists "Users read own imports" on public.source_imports;
create policy "Users read own imports"
  on public.source_imports for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users delete own imports" on public.source_imports;
create policy "Users delete own imports"
  on public.source_imports for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users read own recipes" on public.recipes;
create policy "Users read own recipes"
  on public.recipes for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users create own recipes" on public.recipes;
create policy "Users create own recipes"
  on public.recipes for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own recipes" on public.recipes;
create policy "Users update own recipes"
  on public.recipes for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete own recipes" on public.recipes;
create policy "Users delete own recipes"
  on public.recipes for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users read ingredients from own recipes" on public.ingredients;
create policy "Users read ingredients from own recipes"
  on public.ingredients for select to authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and r.user_id = (select auth.uid())
  ));

drop policy if exists "Users manage ingredients on own recipes" on public.ingredients;
create policy "Users manage ingredients on own recipes"
  on public.ingredients for all to authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and r.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and r.user_id = (select auth.uid())
  ));

drop policy if exists "Users read steps from own recipes" on public.preparation_steps;
create policy "Users read steps from own recipes"
  on public.preparation_steps for select to authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and r.user_id = (select auth.uid())
  ));

drop policy if exists "Users manage steps on own recipes" on public.preparation_steps;
create policy "Users manage steps on own recipes"
  on public.preparation_steps for all to authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and r.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and r.user_id = (select auth.uid())
  ));

-- Import rows include temporary transcript text and are accessed only through
-- authenticated server routes. Do not expose this table through the Data API.
revoke all on public.source_imports from anon, authenticated;
revoke all on public.recipes, public.ingredients, public.preparation_steps from anon;
grant all on public.source_imports, public.recipes, public.ingredients, public.preparation_steps to service_role;
grant select, insert, update, delete on public.recipes to authenticated;
grant select, insert, update, delete on public.ingredients, public.preparation_steps to authenticated;
