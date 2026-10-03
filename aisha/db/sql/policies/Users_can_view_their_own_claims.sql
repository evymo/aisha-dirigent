-- Policy: Users can view their own claims

CREATE POLICY "Users can view their own claims" ON public.invitation_claims
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((user_id = auth.uid()));
