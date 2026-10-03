-- Policy: Anyone can view products

CREATE POLICY "Anyone can view products" ON public.products
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((is_public = true) AND (is_active = true)));
