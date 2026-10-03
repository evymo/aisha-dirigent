-- ============================================================================
-- Source of Truth: commit_slot_switch
-- Popis: Commituje B/G switch (mění active_slot, updatuje image_tag) a uvolňuje
--        lock. Idempotent: pokud active_slot už je p_new_active_slot, vrátí
--        current row bez změny. Pokud lock není drženo aktuálním ownerem, raisuje.
-- Volá: WF_BLUE_GREEN_ORCHESTRATOR po smoke-test pass + approval
-- Auth: service_role (n8n) nebo admin/staff
-- ============================================================================

CREATE OR REPLACE FUNCTION public.commit_slot_switch(
  p_app_name        text,
  p_new_active_slot text,
  p_image_tag       text,
  p_lock_owner      text,
  p_actor           uuid DEFAULT NULL
)
RETURNS public.coolify_app_slots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row     public.coolify_app_slots;
  v_old_slot text;
  v_is_service boolean;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required' USING ERRCODE = '22023';
  END IF;

  IF p_new_active_slot NOT IN ('blue', 'green') THEN
    RAISE EXCEPTION 'Invalid slot: % (must be blue or green)', p_new_active_slot USING ERRCODE = '22023';
  END IF;

  -- Verify lock held by this owner
  SELECT * INTO v_row
  FROM public.coolify_app_slots
  WHERE app_name = p_app_name;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'App slot not found: %', p_app_name USING ERRCODE = '22023';
  END IF;

  IF NOT v_row.switch_lock THEN
    RAISE EXCEPTION 'No active lock for app: %', p_app_name USING ERRCODE = '22023';
  END IF;

  IF v_row.switch_lock_by IS DISTINCT FROM p_lock_owner THEN
    RAISE EXCEPTION 'Lock owned by another process: % (current: %)',
      v_row.switch_lock_by, p_lock_owner USING ERRCODE = '22023';
  END IF;

  v_old_slot := v_row.active_slot;

  -- Idempotent: same slot, no-op (just release lock + update image_tag)
  IF v_old_slot = p_new_active_slot THEN
    UPDATE public.coolify_app_slots
    SET switch_lock = false,
        switch_lock_at = NULL,
        switch_lock_by = NULL,
        blue_image_tag = CASE WHEN p_new_active_slot = 'blue' THEN p_image_tag ELSE blue_image_tag END,
        green_image_tag = CASE WHEN p_new_active_slot = 'green' THEN p_image_tag ELSE green_image_tag END,
        updated_at = now()
    WHERE app_name = p_app_name
    RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  -- Real switch
  UPDATE public.coolify_app_slots
  SET active_slot     = p_new_active_slot,
      blue_image_tag  = CASE WHEN p_new_active_slot = 'blue' THEN p_image_tag ELSE blue_image_tag END,
      green_image_tag = CASE WHEN p_new_active_slot = 'green' THEN p_image_tag ELSE green_image_tag END,
      last_switch_at  = now(),
      last_switch_by  = COALESCE(p_actor, auth.uid()),
      switch_lock     = false,
      switch_lock_at  = NULL,
      switch_lock_by  = NULL,
      updated_at      = now()
  WHERE app_name = p_app_name
  RETURNING * INTO v_row;

  -- Audit
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    COALESCE(p_actor, auth.uid()),
    'blue_green_switch_committed',
    jsonb_build_object(
      'app_name', p_app_name,
      'from_slot', v_old_slot,
      'to_slot', p_new_active_slot,
      'image_tag', p_image_tag,
      'lock_owner', p_lock_owner
    )
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.commit_slot_switch(text, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commit_slot_switch(text, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_slot_switch(text, text, text, text, uuid) TO service_role;
