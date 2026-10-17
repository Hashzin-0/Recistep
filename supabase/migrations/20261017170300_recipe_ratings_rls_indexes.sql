-- Tighten rating policies and index user-owned rating lookups.
DROP POLICY IF EXISTS recipe_ratings_owner_select ON public.recipe_ratings;
DROP POLICY IF EXISTS recipe_ratings_owner_write ON public.recipe_ratings;
DROP POLICY IF EXISTS recipe_ratings_owner_insert ON public.recipe_ratings;
DROP POLICY IF EXISTS recipe_ratings_owner_update ON public.recipe_ratings;
DROP POLICY IF EXISTS recipe_ratings_owner_delete ON public.recipe_ratings;

CREATE POLICY recipe_ratings_owner_select
  ON public.recipe_ratings FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY recipe_ratings_owner_insert
  ON public.recipe_ratings FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY recipe_ratings_owner_update
  ON public.recipe_ratings FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY recipe_ratings_owner_delete
  ON public.recipe_ratings FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE INDEX IF NOT EXISTS recipe_ratings_user_idx ON public.recipe_ratings(user_id);
