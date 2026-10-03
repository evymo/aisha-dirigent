-- Policy: Users can delete own partner reviews

CREATE POLICY "Users can delete own partner reviews" ON public.partner_reviews
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((auth.uid() = user_id));
