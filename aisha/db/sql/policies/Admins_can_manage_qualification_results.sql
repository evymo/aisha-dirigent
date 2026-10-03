-- Policy: Admins can manage qualification results

DROP POLICY IF EXISTS "Admins can manage qualification results" ON public.qualification_results;
CREATE POLICY "Admins can manage qualification results" ON public.qualification_results
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
