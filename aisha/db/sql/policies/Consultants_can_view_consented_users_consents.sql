-- Policy: Consultants can view consented users consents

CREATE POLICY "Consultants can view consented users consents" ON public.consents
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_consultant_for_user(user_id) AND has_data_sharing_consent(user_id, auth.uid())));
