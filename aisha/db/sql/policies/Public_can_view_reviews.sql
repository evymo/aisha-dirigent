-- Policy: Public can view reviews

CREATE POLICY "Public can view reviews" ON public.order_reviews
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (true);
