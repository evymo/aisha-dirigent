-- Policy: Admin full access to products

DROP POLICY IF EXISTS "Admin full access to products" ON public.member_products;
CREATE POLICY "Admin full access to products" ON public.member_products
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))))
  WITH CHECK ((SELECT is_admin_or_staff((SELECT auth.uid()))));
