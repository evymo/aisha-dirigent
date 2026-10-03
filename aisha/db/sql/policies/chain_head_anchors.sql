-- RLS Policies for chain_head_anchors

-- Admins/staff can view chain-head anchor attestations (audit-read only).
-- Writes go exclusively through the audited record_chain_head_anchor
-- SECURITY DEFINER RPC (service_role) — no direct INSERT policy.
DROP POLICY IF EXISTS "Admins can view chain head anchors" ON public.chain_head_anchors;
CREATE POLICY "Admins can view chain head anchors" ON public.chain_head_anchors
  FOR SELECT USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
