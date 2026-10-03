-- Policy: Consultants can view consented users check-ins

CREATE POLICY "Consultants can view consented users check-ins" ON public.health_check_ins
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_consultant_for_user(user_id) AND has_data_sharing_consent(user_id, auth.uid())));
