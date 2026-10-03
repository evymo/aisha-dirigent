-- Policy: Users can view their own roles

CREATE POLICY "Users can view their own roles" ON public.user_roles
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
