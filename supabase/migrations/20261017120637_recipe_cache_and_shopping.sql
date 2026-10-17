-- Recipe deduplication/cache and persistent shopping lists for Recistep.
alter table public.source_imports
  add column if not exists source_url_hash text,
  add column if not exists source_content_hash text,
  add column if not exists recipe_fingerprint text;
alter table public.recipes add column if not exists recipe_fingerprint text;
create index if not exists source_imports_source_url_hash_idx on public.source_imports (source_url_hash) where source_url_hash is not null;
create index if not exists source_imports_source_content_hash_idx on public.source_imports (source_content_hash) where source_content_hash is not null;
create index if not exists recipes_fingerprint_idx on public.recipes (recipe_fingerprint) where recipe_fingerprint is not null;

create table if not exists public.recipe_cache (
  id uuid primary key default gen_random_uuid(), source_url_hash text, source_content_hash text,
  recipe_fingerprint text not null, recipe_draft jsonb not null, source_metadata jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (source_url_hash is not null or source_content_hash is not null)
);
create index if not exists recipe_cache_source_url_hash_idx on public.recipe_cache (source_url_hash, updated_at desc) where source_url_hash is not null;
create index if not exists recipe_cache_content_hash_idx on public.recipe_cache (source_content_hash, updated_at desc) where source_content_hash is not null;
create index if not exists recipe_cache_fingerprint_idx on public.recipe_cache (recipe_fingerprint, updated_at desc);
alter table public.recipe_cache enable row level security;
revoke all on public.recipe_cache from public, anon, authenticated;
grant select, insert, update, delete on public.recipe_cache to service_role;

create table if not exists public.shopping_lists (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 200), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists shopping_lists_user_updated_idx on public.shopping_lists (user_id, updated_at desc);
alter table public.shopping_lists enable row level security;
create policy shopping_lists_select_own on public.shopping_lists for select to authenticated using ((select auth.uid()) = user_id);
create policy shopping_lists_insert_own on public.shopping_lists for insert to authenticated with check ((select auth.uid()) = user_id);
create policy shopping_lists_update_own on public.shopping_lists for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy shopping_lists_delete_own on public.shopping_lists for delete to authenticated using ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.shopping_lists to authenticated;

create table if not exists public.shopping_list_items (
  id uuid primary key default gen_random_uuid(), shopping_list_id uuid not null references public.shopping_lists(id) on delete cascade,
  name text not null check (length(name) between 1 and 200), normalized_name text not null,
  quantity numeric(12,4) check (quantity is null or quantity > 0), unit text, notes text,
  is_purchased boolean not null default false, source_recipe_ids uuid[] not null default '{}',
  source_ingredient_ids uuid[] not null default '{}', position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists shopping_list_items_list_position_idx on public.shopping_list_items (shopping_list_id, position);
alter table public.shopping_list_items enable row level security;
create policy shopping_list_items_select_own on public.shopping_list_items for select to authenticated using (exists (select 1 from public.shopping_lists l where l.id = shopping_list_id and l.user_id = (select auth.uid())));
create policy shopping_list_items_insert_own on public.shopping_list_items for insert to authenticated with check (exists (select 1 from public.shopping_lists l where l.id = shopping_list_id and l.user_id = (select auth.uid())));
create policy shopping_list_items_update_own on public.shopping_list_items for update to authenticated using (exists (select 1 from public.shopping_lists l where l.id = shopping_list_id and l.user_id = (select auth.uid()))) with check (exists (select 1 from public.shopping_lists l where l.id = shopping_list_id and l.user_id = (select auth.uid())));
create policy shopping_list_items_delete_own on public.shopping_list_items for delete to authenticated using (exists (select 1 from public.shopping_lists l where l.id = shopping_list_id and l.user_id = (select auth.uid())));
grant select, insert, update, delete on public.shopping_list_items to authenticated;

alter table public.recipe_cache add column if not exists normalized_title text;
create index if not exists recipe_cache_normalized_title_idx on public.recipe_cache (normalized_title, updated_at desc) where normalized_title is not null;
create or replace function public.set_recipe_fingerprint_from_import()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.recipe_fingerprint is null and new.source_import_id is not null then
    select si.recipe_fingerprint into new.recipe_fingerprint from public.source_imports si where si.id = new.source_import_id;
  end if;
  return new;
end;
$$;
drop trigger if exists recipes_import_fingerprint on public.recipes;
create trigger recipes_import_fingerprint before insert on public.recipes for each row execute function public.set_recipe_fingerprint_from_import();
revoke all on function public.set_recipe_fingerprint_from_import() from public, anon, authenticated;

create or replace function public.create_shopping_list_from_recipes(p_user_id uuid, p_recipe_ids uuid[])
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_list_id uuid; v_title text; v_count integer; v_requested integer;
begin
  if p_user_id is null or p_recipe_ids is null or cardinality(p_recipe_ids) < 1 or cardinality(p_recipe_ids) > 50 then
    raise exception 'INVALID_RECIPE_IDS' using errcode = '22023';
  end if;
  select count(distinct r.id), string_agg(r.title, ', ' order by r.title) into v_count, v_title
  from public.recipes r where r.user_id = p_user_id and r.is_confirmed and r.id = any(p_recipe_ids);
  select count(distinct id) into v_requested from unnest(p_recipe_ids) as ids(id);
  if v_count <> v_requested then raise exception 'RECIPE_NOT_FOUND_OR_FORBIDDEN' using errcode = '42501'; end if;
  insert into public.shopping_lists(user_id, title) values (p_user_id, left('Compras: ' || coalesce(v_title, 'receitas selecionadas'), 200)) returning id into v_list_id;
  insert into public.shopping_list_items(shopping_list_id, name, normalized_name, quantity, unit, notes, source_recipe_ids, source_ingredient_ids, position)
  select v_list_id, min(i.name), lower(trim(regexp_replace(i.name, '\s+', ' ', 'g'))),
    case when bool_and(i.quantity is not null) then sum(i.quantity) else null end,
    nullif(min(lower(trim(coalesce(i.unit, '')))), ''), string_agg(distinct nullif(trim(i.notes), ''), '; '),
    array_agg(distinct r.id), array_agg(distinct i.id),
    row_number() over (order by lower(trim(regexp_replace(i.name, '\s+', ' ', 'g'))), lower(trim(coalesce(i.unit, '')))) - 1
  from public.ingredients i join public.recipes r on r.id = i.recipe_id
  where r.user_id = p_user_id and r.is_confirmed and r.id = any(p_recipe_ids)
  group by lower(trim(regexp_replace(i.name, '\s+', ' ', 'g'))), lower(trim(coalesce(i.unit, '')));
  return jsonb_build_object('id', v_list_id, 'title', left('Compras: ' || coalesce(v_title, 'receitas selecionadas'), 200));
end;
$$;
revoke all on function public.create_shopping_list_from_recipes(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.create_shopping_list_from_recipes(uuid, uuid[]) to service_role;
