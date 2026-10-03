-- Policy: Users can update own partner profile

CREATE POLICY "Users can update own partner profile" ON public.partner_profiles
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
