-- Remove the "Compras: " prefix from generated shopping list titles and
-- allow scaling ingredient quantities to a requested number of servings.
create or replace function public.create_shopping_list_from_recipes(p_user_id uuid, p_recipe_ids uuid[], p_target_servings numeric[] default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_list_id uuid; v_title text; v_count integer; v_requested integer;
begin
  if p_user_id is null or p_recipe_ids is null or cardinality(p_recipe_ids) < 1 or cardinality(p_recipe_ids) > 50 then
    raise exception 'INVALID_RECIPE_IDS' using errcode = '22023';
  end if;
  if p_target_servings is not null and cardinality(p_target_servings) <> cardinality(p_recipe_ids) then
    raise exception 'INVALID_SERVINGS' using errcode = '22023';
  end if;
  if p_target_servings is not null then
    for i in 1..cardinality(p_target_servings) loop
      if p_target_servings[i] is null or p_target_servings[i] <= 0 then
        raise exception 'INVALID_SERVINGS' using errcode = '22023';
      end if;
    end loop;
  end if;
  select count(distinct r.id), string_agg(r.title, ', ' order by r.title) into v_count, v_title
  from public.recipes r where r.user_id = p_user_id and r.is_confirmed and r.id = any(p_recipe_ids);
  select count(distinct id) into v_requested from unnest(p_recipe_ids) as ids(id);
  if v_count <> v_requested then raise exception 'RECIPE_NOT_FOUND_OR_FORBIDDEN' using errcode = '42501'; end if;
  insert into public.shopping_lists(user_id, title) values (p_user_id, left(coalesce(v_title, 'receitas selecionadas'), 200)) returning id into v_list_id;
  insert into public.shopping_list_items(shopping_list_id, name, normalized_name, quantity, unit, notes, source_recipe_ids, source_ingredient_ids, position)
  select v_list_id, min(i.name), lower(trim(regexp_replace(i.name, '\s+', ' ', 'g'))),
    case when bool_and(i.quantity is not null) then sum(
      case
        when req.target_servings is not null and req.base_servings is not null and req.base_servings > 0
        then i.quantity * (req.target_servings / req.base_servings)
        else i.quantity
      end
    ) else null end,
    nullif(min(lower(trim(coalesce(i.unit, '')))), ''),
    string_agg(distinct nullif(trim(i.notes), ''), '; '),
    array_agg(distinct r.id), array_agg(distinct i.id),
    row_number() over (order by lower(trim(regexp_replace(i.name, '\s+', ' ', 'g'))), lower(trim(coalesce(i.unit, '')))) - 1
  from public.ingredients i
  join public.recipes r on r.id = i.recipe_id
  join (
    select rec.id as recipe_id, rec.servings as base_servings,
      case when p_target_servings is null then null
           else (select p_target_servings[min(u.ord)] from unnest(p_recipe_ids) with ordinality as u(recipe_id, ord) where u.recipe_id = rec.id)
      end as target_servings
    from public.recipes rec
    where rec.id = any(p_recipe_ids)
  ) req on req.recipe_id = r.id
  where r.user_id = p_user_id and r.is_confirmed and r.id = any(p_recipe_ids)
  group by lower(trim(regexp_replace(i.name, '\s+', ' ', 'g'))), lower(trim(coalesce(i.unit, '')));
  return jsonb_build_object('id', v_list_id, 'title', left(coalesce(v_title, 'receitas selecionadas'), 200));
end;
$$;
revoke all on function public.create_shopping_list_from_recipes(uuid, uuid[], numeric[]) from public, anon, authenticated;
grant execute on function public.create_shopping_list_from_recipes(uuid, uuid[], numeric[]) to service_role;
