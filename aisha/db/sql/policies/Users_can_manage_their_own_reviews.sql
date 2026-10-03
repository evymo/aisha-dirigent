-- Policy: Users can manage their own reviews

CREATE POLICY "Users can manage their own reviews" ON public.order_reviews
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((user_id = auth.uid()));
