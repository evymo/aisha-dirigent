-- Policy: Admins can manage blinding config

DROP POLICY IF EXISTS "Admins can manage blinding config" ON public.study_blinding_config;
CREATE POLICY "Admins can manage blinding config" ON public.study_blinding_config
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
