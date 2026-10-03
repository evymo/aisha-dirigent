-- Policy: Admin can manage consultants

DROP POLICY IF EXISTS "Admin can manage consultants" ON public.study_consultants;
CREATE POLICY "Admin can manage consultants" ON public.study_consultants
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
