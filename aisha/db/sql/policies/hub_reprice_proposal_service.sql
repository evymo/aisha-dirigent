-- Policy: hub_reprice_proposal_service

DROP POLICY IF EXISTS hub_reprice_proposal_service ON public.hub_reprice_proposal;
CREATE POLICY hub_reprice_proposal_service ON public.hub_reprice_proposal FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role') WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
