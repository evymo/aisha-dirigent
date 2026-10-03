-- Policy: Users can update own partner reviews

CREATE POLICY "Users can update own partner reviews" ON public.partner_reviews
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
