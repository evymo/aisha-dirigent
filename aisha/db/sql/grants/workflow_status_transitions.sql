-- Grants: workflow_status_transitions
-- Read-only direct access for authenticated; service_role bypasses RLS.
-- Mutations via future admin RPCs.

REVOKE ALL ON TABLE public.workflow_status_transitions FROM PUBLIC;
GRANT SELECT ON TABLE public.workflow_status_transitions TO authenticated;
GRANT ALL ON TABLE public.workflow_status_transitions TO service_role;

-- Sequence grants — necessary so service_role inserts can claim ids.
REVOKE ALL ON SEQUENCE public.workflow_status_transitions_id_seq FROM PUBLIC;
GRANT USAGE, SELECT ON SEQUENCE public.workflow_status_transitions_id_seq TO service_role;
