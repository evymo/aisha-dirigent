-- ============================================================================
-- Source of Truth: update_slot_health
-- Popis: Updates blue_health / green_health column on coolify_app_slots.
--        Volat z health-check workflow nebo smoke-test edge function po deployment.
-- Auth: service_role nebo admin/staff
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_slot_health(
  p_app_name text,
  p_slot     text,
  p_health   text
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
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '22023';
  END IF;

  IF p_slot NOT IN ('blue', 'green') THEN
    RAISE EXCEPTION 'Invalid slot: %', p_slot USING ERRCODE = '22023';
  END IF;
  IF p_health NOT IN ('healthy', 'degraded', 'down', 'unknown') THEN
    RAISE EXCEPTION 'Invalid health: %', p_health USING ERRCODE = '22023';
  END IF;

  IF p_slot = 'blue' THEN
    UPDATE public.coolify_app_slots
    SET blue_health = p_health, updated_at = now()
    WHERE app_name = p_app_name
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.coolify_app_slots
    SET green_health = p_health, updated_at = now()
    WHERE app_name = p_app_name
    RETURNING * INTO v_row;
  END IF;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'App slot not found: %', p_app_name USING ERRCODE = '22023';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_slot_health(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_slot_health(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_slot_health(text, text, text) TO service_role;
