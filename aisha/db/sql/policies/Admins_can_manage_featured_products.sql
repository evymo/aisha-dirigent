-- Policy: Admins can manage featured products

DROP POLICY IF EXISTS "Admins can manage featured products" ON public.featured_products;
CREATE POLICY "Admins can manage featured products" ON public.featured_products
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
