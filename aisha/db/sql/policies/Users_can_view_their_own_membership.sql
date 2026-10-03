-- Policy: Users can view their own membership

CREATE POLICY "Users can view their own membership" ON public.memberships
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((user_id = auth.uid()));
