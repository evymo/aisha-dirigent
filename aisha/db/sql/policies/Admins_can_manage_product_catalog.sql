-- Policy: Admins can manage product catalog

DROP POLICY IF EXISTS "Admins can manage product catalog" ON public.product_catalog;
CREATE POLICY "Admins can manage product catalog" ON public.product_catalog
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
