-- Policy: Admin can view all consent acceptances

DROP POLICY IF EXISTS "Admin can view all consent acceptances" ON public.study_consent_acceptances;
CREATE POLICY "Admin can view all consent acceptances" ON public.study_consent_acceptances
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
