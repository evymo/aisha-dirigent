-- Policy: Admin can manage registrations

DROP POLICY IF EXISTS "Admin can manage registrations" ON public.study_registrations;
CREATE POLICY "Admin can manage registrations" ON public.study_registrations
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
