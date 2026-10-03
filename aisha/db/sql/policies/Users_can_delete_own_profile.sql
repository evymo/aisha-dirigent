-- Policy: Users can delete own profile

CREATE POLICY "Users can delete own profile" ON public.profiles
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((auth.uid() = user_id));
