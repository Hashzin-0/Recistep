-- Persist reviewed recipe data atomically. Only trusted server code may execute this function.
alter table public.source_imports
  add column if not exists recipe_id uuid references public.recipes(id) on delete set null;

create or replace function public.confirm_recipe_from_import(
  p_import_id uuid,
  p_user_id uuid,
  p_recipe jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_import public.source_imports%rowtype;
  v_recipe_id uuid;
begin
  if p_user_id is null or p_import_id is null or jsonb_typeof(p_recipe) <> 'object' then
    raise exception 'INVALID_CONFIRMATION_REQUEST' using errcode = '22023';
  end if;

  select * into v_import
  from public.source_imports
  where id = p_import_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'IMPORT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_import.recipe_id is not null then
    return jsonb_build_object('recipe_id', v_import.recipe_id, 'already_confirmed', true);
  end if;

  if v_import.status <> 'review_required' or v_import.recipe_draft is null then
    raise exception 'IMPORT_NOT_READY_FOR_REVIEW' using errcode = '55000';
  end if;

  if p_recipe->>'title' is null
     or jsonb_typeof(p_recipe->'ingredients') <> 'array'
     or jsonb_array_length(p_recipe->'ingredients') < 1
     or jsonb_typeof(p_recipe->'steps') <> 'array'
     or jsonb_array_length(p_recipe->'steps') < 1 then
    raise exception 'INVALID_RECIPE_SHAPE' using errcode = '22023';
  end if;

  insert into public.recipes (
    user_id, source_import_id, title, description, source_url, source_language,
    servings, prep_seconds, cook_seconds, total_seconds, uncertainties, warnings, is_confirmed
  ) values (
    p_user_id,
    p_import_id,
    p_recipe->>'title',
    nullif(p_recipe->>'description', ''),
    v_import.source_url,
    nullif(p_recipe->>'source_language', ''),
    nullif(p_recipe->>'servings', 'null')::numeric,
    nullif(p_recipe#>>'{timings,prep_seconds}', 'null')::integer,
    nullif(p_recipe#>>'{timings,cook_seconds}', 'null')::integer,
    nullif(p_recipe#>>'{timings,total_seconds}', 'null')::integer,
    coalesce(p_recipe->'uncertainties', '[]'::jsonb),
    coalesce(p_recipe->'warnings', '[]'::jsonb),
    true
  )
  returning id into v_recipe_id;

  insert into public.ingredients (
    recipe_id, name, quantity, unit, notes, source_evidence, confidence, position
  )
  select
    v_recipe_id,
    ingredient->>'name',
    nullif(ingredient->>'quantity', 'null')::numeric,
    nullif(ingredient->>'unit', ''),
    nullif(ingredient->>'notes', ''),
    nullif(ingredient->>'source_evidence', ''),
    (ingredient->>'confidence')::numeric,
    (item.ordinality - 1)::integer
  from jsonb_array_elements(p_recipe->'ingredients') with ordinality as item(ingredient, ordinality);

  insert into public.preparation_steps (
    recipe_id, position, instruction, duration_seconds, temperature_value,
    temperature_unit, source_evidence, confidence
  )
  select
    v_recipe_id,
    (step->>'position')::integer,
    step->>'instruction',
    nullif(step->>'duration_seconds', 'null')::integer,
    nullif(step->>'temperature_value', 'null')::numeric,
    nullif(step->>'temperature_unit', ''),
    nullif(step->>'source_evidence', ''),
    (step->>'confidence')::numeric
  from jsonb_array_elements(p_recipe->'steps') as item(step);

  update public.source_imports
  set status = 'completed',
      recipe_id = v_recipe_id,
      recipe_draft = p_recipe,
      error_code = null,
      error_message = null,
      updated_at = now()
  where id = p_import_id;

  return jsonb_build_object('recipe_id', v_recipe_id, 'already_confirmed', false);
end;
$$;

revoke all on function public.confirm_recipe_from_import(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.confirm_recipe_from_import(uuid, uuid, jsonb) to service_role;
