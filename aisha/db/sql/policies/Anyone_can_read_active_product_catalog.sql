-- Policy: Anyone can read active product catalog

CREATE POLICY "Anyone can read active product catalog" ON public.product_catalog
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_active = true));
