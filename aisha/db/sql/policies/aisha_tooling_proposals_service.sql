-- Policy: aisha_tooling_proposals_service

CREATE POLICY aisha_tooling_proposals_service ON public.aisha_tooling_proposals
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
