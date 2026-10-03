-- Policy: Anyone can view product reviews

CREATE POLICY "Anyone can view product reviews" ON public.product_reviews
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
