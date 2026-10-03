-- Policy: Users can manage own matching profile

CREATE POLICY "Users can manage own matching profile" ON public.partner_matching_profiles
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((auth.uid() = user_id));
