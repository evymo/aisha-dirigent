-- ============================================================================
-- Source of Truth: resolve_drift
-- Popis: Označí drift jako resolved. Volat po úspěšné remediation
--        (auto, approved, manual) nebo pro ignored drift. Loguje do audit_journal.
-- Volá: WF_DRIFT_OBSERVER (po auto-fix) nebo admin manuálně
-- Auth: service_role nebo admin/staff
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_drift(
  p_drift_id        uuid,
  p_remediation     text,
  p_resolution_note text DEFAULT NULL
)
RETURNS public.drift_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.drift_state;
  v_is_service boolean;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required' USING ERRCODE = '22023';
  END IF;

  IF p_remediation NOT IN ('auto', 'approved', 'manual', 'ignored') THEN
    RAISE EXCEPTION 'Invalid remediation: % (must be auto, approved, manual, ignored)', p_remediation USING ERRCODE = '22023';
  END IF;

  UPDATE public.drift_state
  SET remediation     = p_remediation,
      resolved_at     = now(),
      resolved_by     = auth.uid(),
      resolution_note = COALESCE(p_resolution_note, resolution_note)
  WHERE id = p_drift_id
    AND resolved_at IS NULL
  RETURNING * INTO v_row;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'Drift % not found or already resolved', p_drift_id USING ERRCODE = '22023';
  END IF;

  -- Audit
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'drift_resolved',
    jsonb_build_object(
      'drift_id', p_drift_id,
      'app_name', v_row.app_name,
      'drift_kind', v_row.drift_kind,
      'remediation', p_remediation,
      'risk_level', v_row.risk_level
    )
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_drift(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_drift(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_drift(uuid, text, text) TO service_role;
