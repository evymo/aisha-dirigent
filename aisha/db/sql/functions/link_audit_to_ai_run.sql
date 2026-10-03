-- Function: public.link_audit_to_ai_run
-- Purpose: Post-hoc correlation — attach an audit_journal entry to an AI run
--          and/or Langfuse trace after the entry was created.
--          Enables full audit ↔ ai_runs ↔ ai_trace_events ↔ Langfuse traceability.
-- Requires: audit_journal.ai_run_id column (added in migration 20260404120000)
-- Security: SECURITY DEFINER with search_path set.
-- Part of: Fáze 2 — Audit-Trace Correlation

CREATE OR REPLACE FUNCTION public.link_audit_to_ai_run(
  p_audit_id          uuid,
  p_ai_run_id         uuid,
  p_langfuse_trace_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Verify ai_run_id ownership: caller must own the run or be service_role
  IF auth.role() <> 'service_role' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.ai_runs
      WHERE id = p_ai_run_id
        AND actor_user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'ai_run not found or access denied: %', p_ai_run_id;
    END IF;
  END IF;

  -- Only allow updating if audit entry belongs to current user OR caller is service_role
  UPDATE public.audit_journal
  SET
    ai_run_id         = p_ai_run_id,
    langfuse_trace_id = COALESCE(p_langfuse_trace_id, langfuse_trace_id)
  WHERE id = p_audit_id
    AND (user_id = auth.uid() OR auth.role() = 'service_role');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'audit_journal entry not found or access denied: %', p_audit_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.link_audit_to_ai_run(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_audit_to_ai_run(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_audit_to_ai_run(uuid, uuid, text) TO service_role;
