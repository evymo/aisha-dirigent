-- Policy: aisha_tooling_proposals_read

DROP POLICY IF EXISTS aisha_tooling_proposals_read ON public.aisha_tooling_proposals;
CREATE POLICY aisha_tooling_proposals_read ON public.aisha_tooling_proposals
  FOR SELECT USING ((SELECT public.is_admin_or_staff()));
