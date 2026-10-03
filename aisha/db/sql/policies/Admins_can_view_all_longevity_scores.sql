-- Policy: Admins can view all longevity scores

DROP POLICY IF EXISTS "Admins can view all longevity scores" ON public.longevity_scores;
CREATE POLICY "Admins can view all longevity scores" ON public.longevity_scores
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
