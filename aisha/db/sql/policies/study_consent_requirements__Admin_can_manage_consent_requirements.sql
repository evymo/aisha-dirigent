-- Policy: Admin can manage consent requirements

DROP POLICY IF EXISTS "Admin can manage consent requirements" ON public.study_consent_requirements;
CREATE POLICY "Admin can manage consent requirements" ON public.study_consent_requirements
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
