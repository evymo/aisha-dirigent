-- Policy: Admins can manage variants

DROP POLICY IF EXISTS "Admins can manage variants" ON public.production_variants;
CREATE POLICY "Admins can manage variants" ON public.production_variants
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
