-- Policy: Anyone can view featured products

CREATE POLICY "Anyone can view featured products" ON public.featured_products
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_active = true));
