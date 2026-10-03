-- Policy: Users can view own profile

CREATE POLICY "Users can view own profile" ON public.profiles
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
