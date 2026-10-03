-- Policy: Admins can manage resources

DROP POLICY IF EXISTS "Admins can manage resources" ON public.production_resources;
CREATE POLICY "Admins can manage resources" ON public.production_resources
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
