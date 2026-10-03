-- Policy: Users can view own deletion requests

CREATE POLICY "Users can view own deletion requests" ON public.account_deletion_requests
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
