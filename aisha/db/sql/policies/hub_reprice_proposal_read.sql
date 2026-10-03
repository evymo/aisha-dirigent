-- Policy: hub_reprice_proposal_read

DROP POLICY IF EXISTS hub_reprice_proposal_read ON public.hub_reprice_proposal;
CREATE POLICY hub_reprice_proposal_read ON public.hub_reprice_proposal FOR SELECT USING ((SELECT public.is_admin_or_staff()));
