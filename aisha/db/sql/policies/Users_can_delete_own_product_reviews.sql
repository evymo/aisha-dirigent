-- Policy: Users can delete own product reviews

CREATE POLICY "Users can delete own product reviews" ON public.product_reviews
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((auth.uid() = user_id));
