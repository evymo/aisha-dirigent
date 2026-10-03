-- ============================================================================
-- Source of Truth: acquire_slot_lock
-- Popis: Atomický pokus získat switch lock na coolify_app_slots row.
--        Selhává rychle, pokud lock drží jiný proces (a není stale).
--        Stale lock (>10 min) se auto-uvolní novým acquirerem.
-- Volá: WF_BLUE_GREEN_ORCHESTRATOR (n8n workflow)
-- Auth: service_role (n8n) nebo admin/staff
-- ============================================================================

CREATE OR REPLACE FUNCTION public.acquire_slot_lock(
  p_app_name   text,
  p_lock_owner text
)
RETURNS public.coolify_app_slots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.coolify_app_slots;
  v_is_service boolean;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  IF p_app_name IS NULL OR p_app_name = '' THEN
    RAISE EXCEPTION 'app_name required';
  END IF;
  IF p_lock_owner IS NULL OR p_lock_owner = '' THEN
    RAISE EXCEPTION 'lock_owner required';
  END IF;

  UPDATE public.coolify_app_slots
  SET switch_lock = true,
      switch_lock_at = now(),
      switch_lock_by = p_lock_owner,
      updated_at = now()
  WHERE app_name = p_app_name
    AND (
      switch_lock = false
      OR switch_lock_at < now() - interval '10 minutes'  -- stale lock auto-release
    )
  RETURNING * INTO v_row;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'Switch lock held by another process for app: %', p_app_name;
  END IF;

  -- Audit
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'slot_lock_acquired',
    jsonb_build_object(
      'app_name', p_app_name,
      'lock_owner', p_lock_owner,
      'active_slot', v_row.active_slot
    )
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_slot_lock(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acquire_slot_lock(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_slot_lock(text, text) TO service_role;
