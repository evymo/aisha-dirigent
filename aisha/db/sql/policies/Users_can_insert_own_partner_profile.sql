-- Policy: Users can insert own partner profile

CREATE POLICY "Users can insert own partner profile" ON public.partner_profiles
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));
