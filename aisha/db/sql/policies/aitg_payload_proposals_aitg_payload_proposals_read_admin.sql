-- Policy: aitg_payload_proposals_read_admin ON public.aitg_payload_proposals
-- Auto-extracted (back-port reconciliation)

DROP POLICY IF EXISTS "aitg_payload_proposals_read_admin" ON public.aitg_payload_proposals;
CREATE POLICY "aitg_payload_proposals_read_admin" ON public.aitg_payload_proposals AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT is_admin_or_staff()));
