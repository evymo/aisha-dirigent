-- ============================================================================
-- Source of Truth: request_rollback
-- Popis: Insert nový pending rollback request. Volat z WF_SENTRY_OBSERVER po
--        detekci threshold breach. Throttle: max 1 rollback request per app per 30 min
--        (proti spam-u). Loguje do audit_journal.
-- Volá: WF_SENTRY_OBSERVER po correlate_sentry_with_deploys returns rollback_recommended=true
-- Auth: service_role nebo admin/staff
-- ============================================================================

CREATE OR REPLACE FUNCTION public.request_rollback(
  p_app_name           text,
  p_triggered_by       text,
  p_sentry_correlation jsonb DEFAULT NULL,
  p_approval_id        uuid DEFAULT NULL,
  p_metadata           jsonb DEFAULT '{}'::jsonb
)
RETURNS public.rollback_history
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_slot_row public.coolify_app_slots;
  v_row      public.rollback_history;
  v_is_service boolean;
  v_throttle_minutes constant int := 30;
  v_recent_count int;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Throttle: max 1 rollback request per app per 30 min
  SELECT count(*) INTO v_recent_count
  FROM public.rollback_history
  WHERE app_name = p_app_name
    AND triggered_at > now() - (v_throttle_minutes || ' minutes')::interval
    AND approval_status NOT IN ('rejected', 'expired', 'aborted');

  IF v_recent_count > 0 THEN
    RAISE EXCEPTION 'Rollback request throttled for %: % minute window already has pending/active request',
      p_app_name, v_throttle_minutes;
  END IF;

  -- Resolve current slot state
  SELECT * INTO v_slot_row
  FROM public.coolify_app_slots
  WHERE app_name = p_app_name;

  IF v_slot_row IS NULL THEN
    RAISE EXCEPTION 'App slot not found: %', p_app_name;
  END IF;

  -- Insert pending rollback
  INSERT INTO public.rollback_history (
    app_name, triggered_by,
    from_slot, to_slot,
    from_image_tag, to_image_tag,
    sentry_correlation, approval_id,
    approval_status, metadata
  )
  VALUES (
    p_app_name, p_triggered_by,
    v_slot_row.active_slot,
    CASE v_slot_row.active_slot WHEN 'blue' THEN 'green' ELSE 'blue' END,
    CASE v_slot_row.active_slot WHEN 'blue' THEN v_slot_row.blue_image_tag ELSE v_slot_row.green_image_tag END,
    CASE v_slot_row.active_slot WHEN 'blue' THEN v_slot_row.green_image_tag ELSE v_slot_row.blue_image_tag END,
    p_sentry_correlation,
    p_approval_id,
    'pending',
    p_metadata
  )
  RETURNING * INTO v_row;

  -- Audit
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'rollback_requested',
    jsonb_build_object(
      'rollback_id', v_row.id,
      'app_name', p_app_name,
      'triggered_by', p_triggered_by,
      'from_slot', v_row.from_slot,
      'to_slot', v_row.to_slot
    )
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.request_rollback(text, text, jsonb, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_rollback(text, text, jsonb, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_rollback(text, text, jsonb, uuid, jsonb) TO service_role;
