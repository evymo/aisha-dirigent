-- Policy: Consultants can view consented users assessments

CREATE POLICY "Consultants can view consented users assessments" ON public.operational_assessments
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_consultant_for_user(user_id) AND has_data_sharing_consent(user_id, auth.uid())));
