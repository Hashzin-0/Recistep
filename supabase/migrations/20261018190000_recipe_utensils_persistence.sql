-- Persist utensil lists atomically with recipe create/update/confirmation.
-- These functions remain service_role-only; application routes validate the user token.
create or replace function public.create_manual_recipe(p_user_id uuid, p_recipe jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_recipe_id uuid;
begin
  if p_user_id is null or jsonb_typeof(p_recipe) <> 'object'
     or nullif(trim(p_recipe->>'title'), '') is null
     or jsonb_typeof(p_recipe->'ingredients') <> 'array' or jsonb_array_length(p_recipe->'ingredients') < 1
     or jsonb_typeof(p_recipe->'steps') <> 'array' or jsonb_array_length(p_recipe->'steps') < 1
     or (p_recipe ? 'utensils' and jsonb_typeof(p_recipe->'utensils') <> 'array') then
    raise exception 'INVALID_RECIPE_SHAPE' using errcode = '22023';
  end if;
  insert into public.recipes(user_id,source_import_id,title,description,source_url,cover_image_url,source_language,servings,prep_seconds,cook_seconds,total_seconds,uncertainties,warnings,is_confirmed)
  values(p_user_id,null,p_recipe->>'title',nullif(p_recipe->>'description',''),null,nullif(p_recipe->>'cover_image_url',''),nullif(p_recipe->>'source_language',''),nullif(p_recipe->>'servings','null')::numeric,nullif(p_recipe#>>'{timings,prep_seconds}','null')::integer,nullif(p_recipe#>>'{timings,cook_seconds}','null')::integer,nullif(p_recipe#>>'{timings,total_seconds}','null')::integer,coalesce(p_recipe->'uncertainties','[]'::jsonb),coalesce(p_recipe->'warnings','[]'::jsonb),true)
  returning id into v_recipe_id;
  insert into public.ingredients(recipe_id,name,section,quantity,quantity_text,quantity_min,quantity_max,unit,unit_normalized,notes,source_evidence,confidence,position)
  select v_recipe_id,x->>'name',coalesce(nullif(x->>'section',''),'Ingredientes'),nullif(x->>'quantity','null')::numeric,nullif(x->>'quantity_text',''),nullif(x->>'quantity_min','null')::numeric,nullif(x->>'quantity_max','null')::numeric,nullif(x->>'unit',''),nullif(x->>'unit_normalized',''),nullif(x->>'notes',''),nullif(x->>'source_evidence',''),coalesce(nullif(x->>'confidence','')::numeric,0.7),(e.ordinality-1)::integer from jsonb_array_elements(p_recipe->'ingredients') with ordinality e(x,ordinality);
  insert into public.preparation_steps(recipe_id,position,instruction,duration_seconds,duration_text,duration_min_seconds,duration_max_seconds,temperature_value,temperature_unit,source_evidence,confidence)
  select v_recipe_id,(x->>'position')::integer,x->>'instruction',nullif(x->>'duration_seconds','null')::integer,nullif(x->>'duration_text',''),nullif(x->>'duration_min_seconds','null')::integer,nullif(x->>'duration_max_seconds','null')::integer,nullif(x->>'temperature_value','null')::numeric,nullif(x->>'temperature_unit',''),nullif(x->>'source_evidence',''),coalesce(nullif(x->>'confidence','')::numeric,0.7) from jsonb_array_elements(p_recipe->'steps') e(x);
  insert into public.recipe_utensils(recipe_id,name,purpose,quantity,source_evidence,confidence,position)
  select v_recipe_id,trim(x->>'name'),nullif(x->>'purpose',''),nullif(x->>'quantity',''),nullif(x->>'source_evidence',''),coalesce(nullif(x->>'confidence','')::numeric,0.7),(e.ordinality-1)::integer
  from jsonb_array_elements(coalesce(p_recipe->'utensils','[]'::jsonb)) with ordinality e(x,ordinality)
  where nullif(trim(x->>'name'),'') is not null;
  return jsonb_build_object('recipe_id',v_recipe_id);
end; $$;

create or replace function public.update_recipe(p_recipe_id uuid,p_user_id uuid,p_recipe jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_recipe_id uuid;
begin
  if p_user_id is null or p_recipe_id is null or jsonb_typeof(p_recipe) <> 'object'
     or nullif(trim(p_recipe->>'title'),'') is null
     or jsonb_typeof(p_recipe->'ingredients') <> 'array' or jsonb_array_length(p_recipe->'ingredients') < 1
     or jsonb_typeof(p_recipe->'steps') <> 'array' or jsonb_array_length(p_recipe->'steps') < 1
     or (p_recipe ? 'utensils' and jsonb_typeof(p_recipe->'utensils') <> 'array') then
    raise exception 'INVALID_RECIPE_SHAPE' using errcode = '22023';
  end if;
  select id into v_recipe_id from public.recipes where id=p_recipe_id and user_id=p_user_id for update;
  if v_recipe_id is null then raise exception 'RECIPE_NOT_FOUND' using errcode = 'P0002'; end if;
  update public.recipes set title=p_recipe->>'title',description=nullif(p_recipe->>'description',''),cover_image_url=nullif(p_recipe->>'cover_image_url',''),source_language=nullif(p_recipe->>'source_language',''),servings=nullif(p_recipe->>'servings','null')::numeric,prep_seconds=nullif(p_recipe#>>'{timings,prep_seconds}','null')::integer,cook_seconds=nullif(p_recipe#>>'{timings,cook_seconds}','null')::integer,total_seconds=nullif(p_recipe#>>'{timings,total_seconds}','null')::integer,uncertainties=coalesce(p_recipe->'uncertainties','[]'::jsonb),warnings=coalesce(p_recipe->'warnings','[]'::jsonb),updated_at=now() where id=v_recipe_id;
  delete from public.ingredients where recipe_id=v_recipe_id;
  insert into public.ingredients(recipe_id,name,section,quantity,quantity_text,quantity_min,quantity_max,unit,unit_normalized,notes,source_evidence,confidence,position)
  select v_recipe_id,x->>'name',coalesce(nullif(x->>'section',''),'Ingredientes'),nullif(x->>'quantity','null')::numeric,nullif(x->>'quantity_text',''),nullif(x->>'quantity_min','null')::numeric,nullif(x->>'quantity_max','null')::numeric,nullif(x->>'unit',''),nullif(x->>'unit_normalized',''),nullif(x->>'notes',''),nullif(x->>'source_evidence',''),coalesce(nullif(x->>'confidence','')::numeric,0.7),(e.ordinality-1)::integer from jsonb_array_elements(p_recipe->'ingredients') with ordinality e(x,ordinality);
  delete from public.preparation_steps where recipe_id=v_recipe_id;
  insert into public.preparation_steps(recipe_id,position,instruction,duration_seconds,duration_text,duration_min_seconds,duration_max_seconds,temperature_value,temperature_unit,source_evidence,confidence)
  select v_recipe_id,(x->>'position')::integer,x->>'instruction',nullif(x->>'duration_seconds','null')::integer,nullif(x->>'duration_text',''),nullif(x->>'duration_min_seconds','null')::integer,nullif(x->>'duration_max_seconds','null')::integer,nullif(x->>'temperature_value','null')::numeric,nullif(x->>'temperature_unit',''),nullif(x->>'source_evidence',''),coalesce(nullif(x->>'confidence','')::numeric,0.7) from jsonb_array_elements(p_recipe->'steps') e(x);
  delete from public.recipe_utensils where recipe_id=v_recipe_id;
  insert into public.recipe_utensils(recipe_id,name,purpose,quantity,source_evidence,confidence,position)
  select v_recipe_id,trim(x->>'name'),nullif(x->>'purpose',''),nullif(x->>'quantity',''),nullif(x->>'source_evidence',''),coalesce(nullif(x->>'confidence','')::numeric,0.7),(e.ordinality-1)::integer from jsonb_array_elements(coalesce(p_recipe->'utensils','[]'::jsonb)) with ordinality e(x,ordinality) where nullif(trim(x->>'name'),'') is not null;
  return jsonb_build_object('recipe_id',v_recipe_id);
end; $$;

create or replace function public.confirm_recipe_from_import(p_import_id uuid,p_user_id uuid,p_recipe jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_import public.source_imports%rowtype; v_recipe_id uuid;
begin
  if p_user_id is null or p_import_id is null or jsonb_typeof(p_recipe) <> 'object' then raise exception 'INVALID_CONFIRMATION_REQUEST' using errcode='22023'; end if;
  select * into v_import from public.source_imports where id=p_import_id and user_id=p_user_id for update;
  if not found then raise exception 'IMPORT_NOT_FOUND' using errcode='P0002'; end if;
  if v_import.recipe_id is not null then return jsonb_build_object('recipe_id',v_import.recipe_id,'already_confirmed',true); end if;
  if v_import.status <> 'review_required' or v_import.recipe_draft is null then raise exception 'IMPORT_NOT_READY_FOR_REVIEW' using errcode='55000'; end if;
  if nullif(trim(p_recipe->>'title'),'') is null or jsonb_typeof(p_recipe->'ingredients') <> 'array' or jsonb_array_length(p_recipe->'ingredients')<1 or jsonb_typeof(p_recipe->'steps') <> 'array' or jsonb_array_length(p_recipe->'steps')<1 then raise exception 'INVALID_RECIPE_SHAPE' using errcode='22023'; end if;
  insert into public.recipes(user_id,source_import_id,title,description,source_url,cover_image_url,source_language,servings,prep_seconds,cook_seconds,total_seconds,uncertainties,warnings,is_confirmed)
  values(p_user_id,p_import_id,p_recipe->>'title',nullif(p_recipe->>'description',''),v_import.source_url,nullif(p_recipe->>'cover_image_url',''),nullif(p_recipe->>'source_language',''),nullif(p_recipe->>'servings','null')::numeric,nullif(p_recipe#>>'{timings,prep_seconds}','null')::integer,nullif(p_recipe#>>'{timings,cook_seconds}','null')::integer,nullif(p_recipe#>>'{timings,total_seconds}','null')::integer,coalesce(p_recipe->'uncertainties','[]'::jsonb),coalesce(p_recipe->'warnings','[]'::jsonb),true) returning id into v_recipe_id;
  insert into public.ingredients(recipe_id,name,section,quantity,quantity_text,quantity_min,quantity_max,unit,unit_normalized,notes,source_evidence,confidence,position)
  select v_recipe_id,x->>'name',coalesce(nullif(x->>'section',''),'Ingredientes'),nullif(x->>'quantity','null')::numeric,nullif(x->>'quantity_text',''),nullif(x->>'quantity_min','null')::numeric,nullif(x->>'quantity_max','null')::numeric,nullif(x->>'unit',''),nullif(x->>'unit_normalized',''),nullif(x->>'notes',''),nullif(x->>'source_evidence',''),coalesce(nullif(x->>'confidence','')::numeric,0.7),(e.ordinality-1)::integer from jsonb_array_elements(p_recipe->'ingredients') with ordinality e(x,ordinality);
  insert into public.preparation_steps(recipe_id,position,instruction,duration_seconds,duration_text,duration_min_seconds,duration_max_seconds,temperature_value,temperature_unit,source_evidence,confidence)
  select v_recipe_id,(x->>'position')::integer,x->>'instruction',nullif(x->>'duration_seconds','null')::integer,nullif(x->>'duration_text',''),nullif(x->>'duration_min_seconds','null')::integer,nullif(x->>'duration_max_seconds','null')::integer,nullif(x->>'temperature_value','null')::numeric,nullif(x->>'temperature_unit',''),nullif(x->>'source_evidence',''),coalesce(nullif(x->>'confidence','')::numeric,0.7) from jsonb_array_elements(p_recipe->'steps') e(x);
  insert into public.recipe_utensils(recipe_id,name,purpose,quantity,source_evidence,confidence,position)
  select v_recipe_id,trim(x->>'name'),nullif(x->>'purpose',''),nullif(x->>'quantity',''),nullif(x->>'source_evidence',''),coalesce(nullif(x->>'confidence','')::numeric,0.7),(e.ordinality-1)::integer from jsonb_array_elements(coalesce(p_recipe->'utensils','[]'::jsonb)) with ordinality e(x,ordinality) where nullif(trim(x->>'name'),'') is not null;
  update public.source_imports set status='completed',recipe_id=v_recipe_id,recipe_draft=p_recipe,error_code=null,error_message=null,updated_at=now() where id=p_import_id;
  return jsonb_build_object('recipe_id',v_recipe_id,'already_confirmed',false);
end; $$;
revoke all on function public.create_manual_recipe(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_manual_recipe(uuid,jsonb) to service_role;
revoke all on function public.update_recipe(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.update_recipe(uuid,uuid,jsonb) to service_role;
revoke all on function public.confirm_recipe_from_import(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.confirm_recipe_from_import(uuid,uuid,jsonb) to service_role;
