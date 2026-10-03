-- Policy: Consultants can view consented users plans

CREATE POLICY "Consultants can view consented users plans" ON public.member_distribution_plans
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_consultant_for_user(user_id) AND has_data_sharing_consent(user_id, auth.uid())));
