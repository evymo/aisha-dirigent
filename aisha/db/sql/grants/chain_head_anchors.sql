-- Grants: chain_head_anchors
-- Least-privilege: no anon access. authenticated may SELECT (RLS restricts to
-- admin/staff). service_role holds write access; all writes flow through the
-- audited record_chain_head_anchor SECURITY DEFINER RPC.

GRANT SELECT ON public.chain_head_anchors TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.chain_head_anchors TO service_role;
