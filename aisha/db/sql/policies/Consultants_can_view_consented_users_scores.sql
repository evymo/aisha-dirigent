-- Policy: Consultants can view consented users scores

CREATE POLICY "Consultants can view consented users scores" ON public.member_compliance_scores
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_consultant_for_user(member_token) AND has_data_sharing_consent(member_token, auth.uid())));
