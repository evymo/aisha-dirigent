-- Grants: workflow_statuses
-- Mutations go through RPCs (list_workflow_statuses for reads, future
-- admin RPCs for writes). Authenticated role gets read-only direct
-- access for RLS-friendly client SELECTs; service_role bypasses RLS.

REVOKE ALL ON TABLE public.workflow_statuses FROM PUBLIC;
GRANT SELECT ON TABLE public.workflow_statuses TO authenticated;
GRANT ALL ON TABLE public.workflow_statuses TO service_role;
