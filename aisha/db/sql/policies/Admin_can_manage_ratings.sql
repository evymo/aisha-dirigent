-- Policy: Admin can manage ratings

DROP POLICY IF EXISTS "Admin can manage ratings" ON public.study_ratings;
CREATE POLICY "Admin can manage ratings" ON public.study_ratings
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
