-- Policy: Public can view non-anonymous contributions

CREATE POLICY "Public can view non-anonymous contributions" ON public.study_contributions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((is_anonymous = false) AND (status = 'completed'::contribution_status_enum)));
