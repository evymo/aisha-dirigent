-- Policy: Consultants can view consented users lab results

CREATE POLICY "Consultants can view consented users lab results" ON public.lab_results
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((((study_registration_id IS NOT NULL) AND is_consultant_for_registration(study_registration_id)) OR is_consultant_for_user(user_id)) AND has_data_sharing_consent(user_id, auth.uid())));
