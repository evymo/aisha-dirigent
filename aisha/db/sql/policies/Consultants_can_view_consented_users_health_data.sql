-- Policy: Consultants can view consented users health data

CREATE POLICY "Consultants can view consented users health data" ON public.health_data
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_consultant_for_user(user_id) AND has_data_sharing_consent(user_id, auth.uid())));
