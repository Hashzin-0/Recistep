-- Recipe layers, media metadata and user ratings. Apply to the dedicated Recistep Supabase project.
ALTER TABLE public.ingredients ADD COLUMN IF NOT EXISTS section text NOT NULL DEFAULT 'Ingredientes' CHECK (length(section) BETWEEN 1 AND 100);
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS cover_image_url text;
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS preparation_flowchart_url text;

CREATE TABLE IF NOT EXISTS public.recipe_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipe_id, user_id)
);
CREATE INDEX IF NOT EXISTS recipe_ratings_recipe_idx ON public.recipe_ratings(recipe_id);
ALTER TABLE public.recipe_ratings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recipe_ratings_owner_select ON public.recipe_ratings;
CREATE POLICY recipe_ratings_owner_select ON public.recipe_ratings FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS recipe_ratings_owner_write ON public.recipe_ratings;
CREATE POLICY recipe_ratings_owner_write ON public.recipe_ratings FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('recipe-media', 'recipe-media', true, 8388608, ARRAY['image/jpeg','image/png','image/webp']::text[])
ON CONFLICT (id) DO NOTHING;

-- Manual recipe CRUD. Only trusted server code may execute these functions.
-- Apply to the dedicated Recistep Supabase project after review.

-- Identifiers used by the API layer to reference a recipe.
create or replace function public.create_manual_recipe(
  p_user_id uuid,
  p_recipe jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_recipe_id uuid;
begin
  if p_user_id is null or jsonb_typeof(p_recipe) <> 'object' then
    raise exception 'INVALID_RECIPE_REQUEST' using errcode = '22023';
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
    null,
    p_recipe->>'title',
    nullif(p_recipe->>'description', ''),
    null,
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
    recipe_id, name, section, quantity, quantity_text, quantity_min, quantity_max,
    unit, unit_normalized, notes, source_evidence, confidence, position
  )
  select
    v_recipe_id,
    ingredient->>'name',
    coalesce(nullif(ingredient->>'section', ''), 'Ingredientes'),
    nullif(ingredient->>'quantity', 'null')::numeric,
    nullif(ingredient->>'quantity_text', ''),
    nullif(ingredient->>'quantity_min', 'null')::numeric,
    nullif(ingredient->>'quantity_max', 'null')::numeric,
    nullif(ingredient->>'unit', ''),
    nullif(ingredient->>'unit_normalized', ''),
    nullif(ingredient->>'notes', ''),
    nullif(ingredient->>'source_evidence', ''),
    (ingredient->>'confidence')::numeric,
    (item.ordinality - 1)::integer
  from jsonb_array_elements(p_recipe->'ingredients') with ordinality as item(ingredient, ordinality);

  insert into public.preparation_steps (
    recipe_id, position, instruction, duration_seconds, duration_text,
    duration_min_seconds, duration_max_seconds, temperature_value,
    temperature_unit, source_evidence, confidence
  )
  select
    v_recipe_id,
    (step->>'position')::integer,
    step->>'instruction',
    nullif(step->>'duration_seconds', 'null')::integer,
    nullif(step->>'duration_text', ''),
    nullif(step->>'duration_min_seconds', 'null')::integer,
    nullif(step->>'duration_max_seconds', 'null')::integer,
    nullif(step->>'temperature_value', 'null')::numeric,
    nullif(step->>'temperature_unit', ''),
    nullif(step->>'source_evidence', ''),
    (step->>'confidence')::numeric
  from jsonb_array_elements(p_recipe->'steps') as item(step);

  return jsonb_build_object('recipe_id', v_recipe_id);
end;
$$;

create or replace function public.update_recipe(
  p_recipe_id uuid,
  p_user_id uuid,
  p_recipe jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_recipe_id uuid;
begin
  if p_user_id is null or p_recipe_id is null or jsonb_typeof(p_recipe) <> 'object' then
    raise exception 'INVALID_RECIPE_REQUEST' using errcode = '22023';
  end if;

  if p_recipe->>'title' is null
     or jsonb_typeof(p_recipe->'ingredients') <> 'array'
     or jsonb_array_length(p_recipe->'ingredients') < 1
     or jsonb_typeof(p_recipe->'steps') <> 'array'
     or jsonb_array_length(p_recipe->'steps') < 1 then
    raise exception 'INVALID_RECIPE_SHAPE' using errcode = '22023';
  end if;

  select id into v_recipe_id
  from public.recipes
  where id = p_recipe_id and user_id = p_user_id
  for update;

  if v_recipe_id is null then
    raise exception 'RECIPE_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.recipes
  set title = p_recipe->>'title',
      description = nullif(p_recipe->>'description', ''),
      source_language = nullif(p_recipe->>'source_language', ''),
      servings = nullif(p_recipe->>'servings', 'null')::numeric,
      prep_seconds = nullif(p_recipe#>>'{timings,prep_seconds}', 'null')::integer,
      cook_seconds = nullif(p_recipe#>>'{timings,cook_seconds}', 'null')::integer,
      total_seconds = nullif(p_recipe#>>'{timings,total_seconds}', 'null')::integer,
      uncertainties = coalesce(p_recipe->'uncertainties', '[]'::jsonb),
      warnings = coalesce(p_recipe->'warnings', '[]'::jsonb),
      updated_at = now()
  where id = v_recipe_id;

  delete from public.ingredients where recipe_id = v_recipe_id;

  insert into public.ingredients (
    recipe_id, name, section, quantity, quantity_text, quantity_min, quantity_max,
    unit, unit_normalized, notes, source_evidence, confidence, position
  )
  select
    v_recipe_id,
    ingredient->>'name',
    coalesce(nullif(ingredient->>'section', ''), 'Ingredientes'),
    nullif(ingredient->>'quantity', 'null')::numeric,
    nullif(ingredient->>'quantity_text', ''),
    nullif(ingredient->>'quantity_min', 'null')::numeric,
    nullif(ingredient->>'quantity_max', 'null')::numeric,
    nullif(ingredient->>'unit', ''),
    nullif(ingredient->>'unit_normalized', ''),
    nullif(ingredient->>'notes', ''),
    nullif(ingredient->>'source_evidence', ''),
    (ingredient->>'confidence')::numeric,
    (item.ordinality - 1)::integer
  from jsonb_array_elements(p_recipe->'ingredients') with ordinality as item(ingredient, ordinality);

  delete from public.preparation_steps where recipe_id = v_recipe_id;

  insert into public.preparation_steps (
    recipe_id, position, instruction, duration_seconds, duration_text,
    duration_min_seconds, duration_max_seconds, temperature_value,
    temperature_unit, source_evidence, confidence
  )
  select
    v_recipe_id,
    (step->>'position')::integer,
    step->>'instruction',
    nullif(step->>'duration_seconds', 'null')::integer,
    nullif(step->>'duration_text', ''),
    nullif(step->>'duration_min_seconds', 'null')::integer,
    nullif(step->>'duration_max_seconds', 'null')::integer,
    nullif(step->>'temperature_value', 'null')::numeric,
    nullif(step->>'temperature_unit', ''),
    nullif(step->>'source_evidence', ''),
    (step->>'confidence')::numeric
  from jsonb_array_elements(p_recipe->'steps') as item(step);

  return jsonb_build_object('recipe_id', v_recipe_id);
end;
$$;

revoke all on function public.create_manual_recipe(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_manual_recipe(uuid, jsonb) to service_role;
revoke all on function public.update_recipe(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_recipe(uuid, uuid, jsonb) to service_role;
