-- Policy: Users can update own product reviews

CREATE POLICY "Users can update own product reviews" ON public.product_reviews
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
