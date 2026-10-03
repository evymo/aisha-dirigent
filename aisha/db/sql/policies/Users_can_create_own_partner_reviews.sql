-- Policy: Users can create own partner reviews

CREATE POLICY "Users can create own partner reviews" ON public.partner_reviews
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));
