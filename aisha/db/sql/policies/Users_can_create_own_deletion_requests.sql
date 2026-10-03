-- Policy: Users can create own deletion requests

CREATE POLICY "Users can create own deletion requests" ON public.account_deletion_requests
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));
