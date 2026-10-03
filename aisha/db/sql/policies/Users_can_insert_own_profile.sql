-- Policy: Users can insert own profile

CREATE POLICY "Users can insert own profile" ON public.profiles
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));
