-- Grants: delivery_statuses
-- Read-only direct access for authenticated; service_role bypasses RLS.
-- Mutations via future admin RPCs.

REVOKE ALL ON TABLE public.delivery_statuses FROM PUBLIC;
GRANT SELECT ON TABLE public.delivery_statuses TO authenticated;
GRANT ALL ON TABLE public.delivery_statuses TO service_role;
