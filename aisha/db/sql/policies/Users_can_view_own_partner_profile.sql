-- Policy: Users can view own partner profile

CREATE POLICY "Users can view own partner profile" ON public.partner_profiles
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
