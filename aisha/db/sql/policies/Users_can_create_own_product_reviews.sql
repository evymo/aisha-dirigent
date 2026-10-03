-- Policy: Users can create own product reviews

CREATE POLICY "Users can create own product reviews" ON public.product_reviews
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));
